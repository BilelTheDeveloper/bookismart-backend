import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import crypto from 'crypto';
 
/* ─────────────────────────────────────────────────────────────────────────────
   DEPENDENCY NOTE
   ─────────────────────────────────────────────────────────────────────────────
   This middleware requires a Redis client exported from your config, e.g.:
     import { createClient } from 'redis';
     export const redis = createClient({ url: process.env.REDIS_URL });
   
   Install: npm install redis
   ───────────────────────────────────────────────────────────────────────────── */
import { redis } from '../config/redis.js';
 
/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────────────────────── */
 
/** Only users with this status may pass. Every other status is denied. */
const ALLOWED_ACCOUNT_STATUSES = ['active'];
 
/**
 * In-memory fingerprint mismatch tracker.
 * Tracks consecutive mismatch count + first-seen timestamp per user ID.
 * In a multi-server setup, move this to Redis as well.
 * Structure: Map<userId, { count: number, firstSeen: number }>
 */
const fingerprintBreachTracker = new Map();
 
/** How many fingerprint mismatches before a temporary lockout. */
const MAX_FINGERPRINT_VIOLATIONS = 5;
 
/** Lockout window in milliseconds (15 minutes). */
const BREACH_WINDOW_MS = 15 * 60 * 1000;
 
/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────────────────── */
 
/**
 * Generates a short, opaque request ID for log correlation.
 * Never include internal details (user ID, email) in client-facing responses.
 */
const generateRequestId = () => crypto.randomBytes(8).toString('hex');
 
/**
 * Structured security logger — swap for Winston/Pino in production.
 */
const secLog = {
  breach : (msg, meta = {}) => console.error(JSON.stringify({ level: 'SECURITY', msg, ...meta, ts: new Date().toISOString() })),
  warn   : (msg, meta = {}) => console.warn (JSON.stringify({ level: 'WARN',     msg, ...meta, ts: new Date().toISOString() })),
  error  : (msg, meta = {}) => console.error(JSON.stringify({ level: 'ERROR',    msg, ...meta, ts: new Date().toISOString() })),
};
 
/**
 * Timing-safe, length-safe string comparison.
 * Returns false (never throws) on any length mismatch.
 */
const safeEqual = (a, b) => {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};
 
/**
 * Tracks repeated fingerprint violations for a given user ID.
 * Returns true when the user has exceeded the threshold within the window.
 */
const isBreachLimitExceeded = (userId) => {
  const now    = Date.now();
  const record = fingerprintBreachTracker.get(userId) ?? { count: 0, firstSeen: now };
 
  // Reset window if it has expired
  if (now - record.firstSeen > BREACH_WINDOW_MS) {
    fingerprintBreachTracker.set(userId, { count: 1, firstSeen: now });
    return false;
  }
 
  record.count += 1;
  fingerprintBreachTracker.set(userId, record);
  return record.count >= MAX_FINGERPRINT_VIOLATIONS;
};
 
/* ─────────────────────────────────────────────────────────────────────────────
   CORE MIDDLEWARE
   ───────────────────────────────────────────────────────────────────────────── */
 
/**
 * 🛡️  PROTECT  —  Maximum-hardened access-token middleware
 *
 * Security layers (in order of execution):
 *   1. Cookie-only token extraction          — blocks XSS-stolen header tokens
 *   2. JWT signature + expiry verification   — cryptographic integrity
 *   3. Algorithm allowlist                   — prevents "alg: none" attacks
 *   4. jti blacklist (Redis)                 — revokes tokens on logout
 *   5. Fingerprint binding (timing-safe)     — device-locks the token
 *   6. Breach rate limiting                  — locks out repeated mismatches
 *   7. DB freshness check                    — catches deleted/changed users
 *   8. Account-status allowlist              — blocks banned/suspended users
 *   9. Distinct error codes                  — precise frontend handling
 */
export const protect = async (req, res, next) => {
  const requestId = generateRequestId();
 
  /* ── 1. Extract token from HttpOnly cookie ONLY ── */
  const token = req.cookies?.accessToken;
 
  if (!token) {
    return res.status(401).json({
      message : 'Not authorized, access token missing',
      code    : 'TOKEN_MISSING',
    });
  }
 
  let decoded;
 
  try {
    /* ── 2 & 3. Verify signature + enforce algorithm allowlist ──
       Explicitly whitelisting 'HS256' prevents the critical "alg: none"
       attack and algorithm-confusion attacks (e.g. RS256 → HS256 swap).      */
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms : ['HS256'],
    });
 
  } catch (error) {
    /* Distinguish expired vs tampered — the frontend needs different actions  */
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        message : 'Session expired',
        code    : 'TOKEN_EXPIRED',     // → frontend should call /refresh
      });
    }
 
    /* Tampered / malformed / wrong algorithm — never offer a refresh         */
    secLog.breach('Invalid token presented', { requestId, reason: error.message });
    return res.status(401).json({
      message : 'Invalid token',
      code    : 'TOKEN_INVALID',       // → frontend should force logout
    });
  }
 
  /* ── 4. JTI blacklist check (Redis) ──
     Tokens are added here on logout. This closes the window where a stolen
     cookie would remain usable until natural expiry.                          */
  if (!decoded.jti) {
    /* Reject tokens that were issued without a jti — legacy or malformed     */
    return res.status(401).json({ message: 'Invalid token structure', code: 'TOKEN_INVALID' });
  }
 
  try {
    const isRevoked = await redis.get(`blacklist:${decoded.jti}`);
    if (isRevoked) {
      secLog.breach('Revoked token reuse attempt', { requestId, jti: decoded.jti });
      return res.status(401).json({
        message : 'Token has been revoked',
        code    : 'TOKEN_REVOKED',
      });
    }
  } catch (redisError) {
    /* If Redis is down, fail CLOSED (deny access) — security > availability  */
    secLog.error('Redis unavailable during jti check', { requestId, error: redisError.message });
    return res.status(503).json({
      message : 'Authentication service temporarily unavailable',
      code    : 'AUTH_SERVICE_DOWN',
    });
  }
 
  /* ── 5. Strict fingerprint enforcement (timing-safe) ──
     Both sides must be present and identical.                                 */
  const currentFingerprint = req.headers['x-device-fingerprint'];
 
  if (!decoded.fingerprint || !currentFingerprint) {
    return res.status(401).json({
      message : 'Missing identity binding',
      code    : 'FINGERPRINT_MISSING',
    });
  }
 
  if (!safeEqual(decoded.fingerprint, currentFingerprint)) {
    /* ── 6. Breach rate limiting ──
       Count mismatches per user. After MAX_FINGERPRINT_VIOLATIONS within
       BREACH_WINDOW_MS, lock the user out entirely.                          */
    const limitHit = isBreachLimitExceeded(decoded.id);
 
    secLog.breach('Fingerprint mismatch', {
      requestId,
      userId   : decoded.id,
      limitHit,
    });
 
    if (limitHit) {
      return res.status(429).json({
        message : 'Too many security violations. Account temporarily locked.',
        code    : 'BREACH_LIMIT_EXCEEDED',
      });
    }
 
    return res.status(401).json({
      message : 'Device mismatch',
      code    : 'FINGERPRINT_MISMATCH',
    });
  }
 
  /* ── 7. DB freshness check ──
     Performed AFTER fingerprint (avoids a DB hit for bad-faith requests).     */
  let user;
  try {
    user = await User.findById(decoded.id).select('-password -__v');
  } catch (dbError) {
    secLog.error('DB error during user fetch', { requestId, error: dbError.message });
    return res.status(503).json({ message: 'Service temporarily unavailable' });
  }
 
  if (!user) {
    return res.status(401).json({
      message : 'User no longer exists',
      code    : 'USER_NOT_FOUND',
    });
  }
 
  /* ── 8. Account-status allowlist ──
     Allowlist approach: anything not explicitly 'active' is denied.
     Adding new statuses (shadow_banned, pending_review) is automatically safe. */
  if (!ALLOWED_ACCOUNT_STATUSES.includes(user.accountStatus)) {
    secLog.warn('Blocked user attempted access', {
      requestId,
      userId : user._id.toString(),
      status : user.accountStatus,
    });
    return res.status(403).json({
      message : 'Account access restricted',
      code    : 'ACCOUNT_RESTRICTED',
    });
  }
 
  /* ── 9. Attach verified user + request metadata ── */
  req.user      = user;
  req.requestId = requestId;  // available downstream for log correlation
 
  next();
};
 
/* ─────────────────────────────────────────────────────────────────────────────
   ROLE-BASED AUTHORIZATION FACTORIES
   ───────────────────────────────────────────────────────────────────────────── */
 
/**
 * 👑  ADMIN GUARD
 * Must be used AFTER protect().
 */
export const isAdmin = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required', code: 'NOT_AUTHENTICATED' });
  }
  if (req.user.role === 'admin') return next();
 
  secLog.warn('Unauthorized admin access attempt', {
    requestId : req.requestId,
    userId    : req.user._id.toString(),
  });
  return res.status(403).json({
    message : 'Access denied: admin privileges required',
    code    : 'FORBIDDEN',
  });
};
 
/**
 * 🎭  GENERIC ROLE GUARD  —  use for any role beyond admin.
 *
 * Usage:
 *   router.delete('/users/:id', protect, requireRole('admin', 'moderator'), deleteUser);
 */
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ message: 'Authentication required', code: 'NOT_AUTHENTICATED' });
  }
  if (roles.includes(req.user.role)) return next();
 
  secLog.warn('Unauthorized role access attempt', {
    requestId  : req.requestId,
    userId     : req.user._id.toString(),
    userRole   : req.user.role,
    required   : roles,
  });
  return res.status(403).json({
    message : `Access denied: requires one of [${roles.join(', ')}]`,
    code    : 'FORBIDDEN',
  });
};
 
/* ─────────────────────────────────────────────────────────────────────────────
   LOGOUT HELPER  —  call this in your logout controller
   ─────────────────────────────────────────────────────────────────────────────
   import { revokeToken } from '../middleware/authMiddleware.js';
   
   export const logout = async (req, res) => {
     await revokeToken(req.cookies.accessToken);
     res.clearCookie('accessToken', { httpOnly: true, secure: true, sameSite: 'Strict' });
     res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'Strict' });
     res.status(200).json({ message: 'Logged out successfully' });
   };
   ───────────────────────────────────────────────────────────────────────────── */
export const revokeToken = async (token) => {
  if (!token) return;
  try {
    /* Decode without verifying — we only need the jti + exp for TTL          */
    const decoded = jwt.decode(token);
    if (!decoded?.jti || !decoded?.exp) return;
 
    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.set(`blacklist:${decoded.jti}`, '1', { EX: ttl });
    }
  } catch {
    /* Swallow — logout should never fail visibly because of a Redis hiccup   */
  }
};
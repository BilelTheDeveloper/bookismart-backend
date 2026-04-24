import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import crypto from 'crypto';
import { redis } from '../config/redis.js';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────────────────────── */

/** Only users with this status may pass. Every other status is denied. */
const ALLOWED_ACCOUNT_STATUSES = ['active'];

/**
 * In-memory fingerprint mismatch tracker.
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
 */
const generateRequestId = () => crypto.randomBytes(8).toString('hex');

/**
 * Structured security logger.
 */
const secLog = {
  breach : (msg, meta = {}) => console.error(JSON.stringify({ level: 'SECURITY', msg, ...meta, ts: new Date().toISOString() })),
  warn   : (msg, meta = {}) => console.warn (JSON.stringify({ level: 'WARN',     msg, ...meta, ts: new Date().toISOString() })),
  error  : (msg, meta = {}) => console.error(JSON.stringify({ level: 'ERROR',    msg, ...meta, ts: new Date().toISOString() })),
};

/**
 * Timing-safe, length-safe string comparison.
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
 */
const isBreachLimitExceeded = (userId) => {
  const now    = Date.now();
  const record = fingerprintBreachTracker.get(userId) ?? { count: 0, firstSeen: now };

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
    /* ── 2 & 3. Verify signature + enforce algorithm allowlist ── */
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms : ['HS256'],
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        message : 'Session expired',
        code    : 'TOKEN_EXPIRED',
      });
    }

    secLog.breach('Invalid token presented', { requestId, reason: error.message });
    return res.status(401).json({
      message : 'Invalid token',
      code    : 'TOKEN_INVALID',
    });
  }

  /* ── 4. JTI blacklist check (Redis) ── */
  if (!decoded.jti) {
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
    secLog.error('Redis unavailable during jti check', { requestId, error: redisError.message });
    return res.status(503).json({
      message : 'Authentication service temporarily unavailable',
      code    : 'AUTH_SERVICE_DOWN',
    });
  }

  /* ── 5. Strict fingerprint enforcement (timing-safe) ──
     MODIFIED: Using req.deviceFingerprint to sync with the Fingerprinter middleware logic. */
  const currentFingerprint = req.deviceFingerprint;

  if (!decoded.fingerprint || !currentFingerprint) {
    return res.status(401).json({
      message : 'Missing identity binding',
      code    : 'FINGERPRINT_MISSING',
    });
  }

  if (!safeEqual(decoded.fingerprint, currentFingerprint)) {
    /* ── 6. Breach rate limiting ── */
    const limitHit = isBreachLimitExceeded(decoded.id);

    secLog.breach('Fingerprint mismatch detected', {
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

  /* ── 7. DB freshness check ── */
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

  /* ── 8. Account-status allowlist ── */
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
  req.requestId = requestId;

  next();
};

/* ─────────────────────────────────────────────────────────────────────────────
   ROLE-BASED AUTHORIZATION FACTORIES
   ───────────────────────────────────────────────────────────────────────────── */

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
   LOGOUT HELPER
   ───────────────────────────────────────────────────────────────────────────── */
export const revokeToken = async (token) => {
  if (!token) return;
  try {
    const decoded = jwt.decode(token);
    if (!decoded?.jti || !decoded?.exp) return;

    const ttl = decoded.exp - Math.floor(Date.now() / 1000);
    if (ttl > 0) {
      await redis.set(`blacklist:${decoded.jti}`, '1', { EX: ttl });
    }
  } catch {
    // Swallow Redis hiccups
  }
};
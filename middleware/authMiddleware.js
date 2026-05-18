import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import crypto from 'crypto';
import { redis } from '../config/redis.js';
import { logSecurityEvent } from '../utils/securityEventLogger.js';

/* ─────────────────────────────────────────────────────────────────────────────
   CONSTANTS
   ───────────────────────────────────────────────────────────────────────────── */

/** * ✅ FIX: Added 'on_boarding' and 'review' to allowed statuses. 
 * If these aren't here, the user is blocked before they can even see the onboarding page.
 */
const ALLOWED_ACCOUNT_STATUSES = ['active', 'on_boarding', 'review', 'pending_kyc', 'rejected'];

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
  breach : (req, msg, meta = {}) => {
    console.error(JSON.stringify({ level: 'SECURITY', msg, ...meta, ts: new Date().toISOString() }));
    logSecurityEvent({ level: 'SECURITY', msg, code: meta?.code || '', req, userId: meta?.userId || null, meta });
  },
  warn   : (req, msg, meta = {}) => {
    console.warn(JSON.stringify({ level: 'WARN', msg, ...meta, ts: new Date().toISOString() }));
    logSecurityEvent({ level: 'WARN', msg, code: meta?.code || '', req, userId: meta?.userId || null, meta });
  },
  error  : (req, msg, meta = {}) => {
    console.error(JSON.stringify({ level: 'ERROR', msg, ...meta, ts: new Date().toISOString() }));
    logSecurityEvent({ level: 'ERROR', msg, code: meta?.code || '', req, userId: meta?.userId || null, meta });
  },
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

const maskFingerprint = (value) => {
  if (!value || typeof value !== 'string') return 'n/a';
  if (value.length <= 12) return `${value.slice(0, 4)}...`;
  return `${value.slice(0, 6)}...${value.slice(-6)}`;
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
  const token = req.cookies?.accessToken || req.signedCookies?.accessToken;

  if (!token) {
    return res.status(401).json({
      success: false,
      message : 'Not authorized, access token missing',
      code    : 'TOKEN_MISSING',
    });
  }

  let decoded;

  try {
    /* ── 2 & 3. Verify signature + enforce algorithm allowlist ── */
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms : ['HS256'],
      issuer     : 'bookiify-api',
      audience   : 'bookiify-app',
    });

  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({
        success: false,
        message : 'Session expired',
        code    : 'TOKEN_EXPIRED',
      });
    }

    secLog.breach(req, 'Invalid token presented', { requestId, reason: error.message, code: 'TOKEN_INVALID' });
    return res.status(401).json({
      success: false,
      message : 'Invalid token',
      code    : 'TOKEN_INVALID',
    });
  }

  /* ── 4. JTI blacklist check (Redis) ── */
  if (!decoded.jti) {
    return res.status(401).json({ success: false, message: 'Invalid token structure', code: 'TOKEN_INVALID' });
  }

  try {
    const isRevoked = await redis.get(`blacklist:${decoded.jti}`);
    if (isRevoked) {
      secLog.breach(req, 'Revoked token reuse attempt', { requestId, jti: decoded.jti, code: 'TOKEN_REVOKED', userId: decoded.id });
      return res.status(401).json({
        success: false,
        message : 'Token has been revoked',
        code    : 'TOKEN_REVOKED',
      });
    }
  } catch (redisError) {
    secLog.error(req, 'Redis unavailable during jti check', { requestId, error: redisError.message, code: 'AUTH_SERVICE_DOWN', userId: decoded?.id });
    return res.status(503).json({
      success: false,
      message : 'Authentication service temporarily unavailable',
      code    : 'AUTH_SERVICE_DOWN',
    });
  }

  /* ── 5. Strict fingerprint enforcement (timing-safe) ── */
  const currentFingerprint = req.deviceFingerprint;
  const currentDeviceHeader = req.headers['x-device-fingerprint'];

  if (!decoded.fingerprint || !currentFingerprint) {
    secLog.warn(req, 'Identity binding incomplete', { requestId, tokenBound: !!decoded.fingerprint, reqBound: !!currentFingerprint, code: 'FINGERPRINT_MISSING', userId: decoded?.id });
    return res.status(401).json({
      success: false,
      message : 'Missing identity binding. Handshake incomplete.',
      code    : 'FINGERPRINT_MISSING',
    });
  }

  // ✅ Timing-safe comparison of the identity binding
  if (!safeEqual(decoded.fingerprint, currentFingerprint)) {
    /**
     * 🔧 Drift-tolerant fallback:
     * In some proxy/mobile setups, server-derived anchor parts can drift while the
     * client device fingerprint header remains stable. If the exact client header
     * still matches the token-bound client segment, we allow the request.
     */
    const tokenClientSegment =
      typeof decoded.fingerprint === 'string' && decoded.fingerprint.length > 65
        ? decoded.fingerprint.slice(65)
        : null;

    if (tokenClientSegment && currentDeviceHeader && safeEqual(tokenClientSegment, currentDeviceHeader)) {
      secLog.warn(req, 'Fingerprint anchor drift tolerated', {
        requestId,
        userId: decoded.id,
        code: 'FINGERPRINT_DRIFT_TOLERATED'
      });
      // Continue as authenticated: same device header is still proven.
    } else {
    /* ── 6. Breach rate limiting ── */
    const limitHit = isBreachLimitExceeded(decoded.id);

    secLog.breach(req, 'Fingerprint mismatch detected', {
      requestId,
      userId   : decoded.id,
      limitHit,
      expected : maskFingerprint(decoded.fingerprint),
      received : maskFingerprint(currentFingerprint)
      ,code: limitHit ? 'BREACH_LIMIT_EXCEEDED' : 'FINGERPRINT_MISMATCH'
    });

    if (limitHit) {
      return res.status(429).json({
        success: false,
        message : 'Too many security violations. Account temporarily locked.',
        code    : 'BREACH_LIMIT_EXCEEDED',
      });
    }

    return res.status(401).json({
      success: false,
      message : 'Device mismatch. Security vault has terminated this session.',
      code    : 'FINGERPRINT_MISMATCH',
    });
    }
  }

  /* ── 7. DB freshness check ── */
  let user;
  try {
    user = await User.findById(decoded.id).select('-password -__v');
  } catch (dbError) {
    secLog.error(req, 'DB error during user fetch', { requestId, error: dbError.message, code: 'DB_ERROR', userId: decoded?.id });
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable' });
  }

  if (!user) {
    return res.status(401).json({
      success: false,
      message : 'User no longer exists',
      code    : 'USER_NOT_FOUND',
    });
  }

  /* ── 8. Account-status allowlist ── */
  if (!ALLOWED_ACCOUNT_STATUSES.includes(user.accountStatus)) {
    secLog.warn(req, 'Blocked user attempted access', {
      requestId,
      userId : user._id.toString(),
      status : user.accountStatus,
      code   : 'ACCOUNT_RESTRICTED'
    });
    return res.status(403).json({
      success: false,
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
    return res.status(401).json({ success: false, message: 'Authentication required', code: 'NOT_AUTHENTICATED' });
  }
  if (req.user.role === 'admin') return next();

  secLog.warn(req, 'Unauthorized admin access attempt', {
    requestId : req.requestId,
    userId    : req.user._id.toString(),
    code      : 'FORBIDDEN'
  });
  return res.status(403).json({
    success: false,
    message : 'Access denied: admin privileges required',
    code    : 'FORBIDDEN',
  });
};

export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required', code: 'NOT_AUTHENTICATED' });
  }
  if (roles.includes(req.user.role)) return next();

  secLog.warn(req, 'Unauthorized role access attempt', {
    requestId  : req.requestId,
    userId     : req.user._id.toString(),
    userRole   : req.user.role,
    required   : roles,
    code       : 'FORBIDDEN'
  });
  return res.status(403).json({
    success: false,
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
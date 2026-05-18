import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import Staff from '../models/Staff.js';
import { redis } from '../config/redis.js';
import { calculateServerAnchor } from '../utils/fingerprintHelper.js';
import { logSecurityEvent } from '../utils/securityEventLogger.js';

const safeEqual = (a, b) => {
  try {
    const ba = Buffer.from(a);
    const bb = Buffer.from(b);
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

export const staffProtect = async (req, res, next) => {
  const token = req.cookies?.staffAccessToken;

  if (!token) {
    return res.status(401).json({ success: false, message: 'Not authorized — token missing', code: 'TOKEN_MISSING' });
  }

  let decoded;
  try {
    decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer: 'bookiify-api',
      audience: 'bookiify-staff',
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ success: false, message: 'Session expired', code: 'TOKEN_EXPIRED' });
    }
    return res.status(401).json({ success: false, message: 'Invalid token', code: 'TOKEN_INVALID' });
  }

  if (decoded.role !== 'staff') {
    return res.status(403).json({ success: false, message: 'Access denied', code: 'FORBIDDEN' });
  }

  if (!decoded.jti) {
    return res.status(401).json({ success: false, message: 'Invalid token structure', code: 'TOKEN_INVALID' });
  }

  try {
    const revoked = await redis.get(`blacklist:${decoded.jti}`);
    if (revoked) {
      return res.status(401).json({ success: false, message: 'Token has been revoked', code: 'TOKEN_REVOKED' });
    }
  } catch (redisErr) {
    logSecurityEvent({
      level: 'SECURITY',
      msg: 'Redis unavailable during staff JTI check — rejecting',
      code: 'AUTH_SERVICE_DOWN',
      req,
      userId: decoded?.id,
      meta: { error: redisErr.message },
    });
    return res.status(503).json({ success: false, message: 'Authentication service temporarily unavailable', code: 'AUTH_SERVICE_DOWN' });
  }

  if (decoded.fingerprint) {
    const clientHeader  = req.headers['x-device-fingerprint'];
    const serverAnchor  = calculateServerAnchor(req);
    const currentBound  = clientHeader ? `${serverAnchor}-${clientHeader}` : null;

    if (!currentBound || !safeEqual(decoded.fingerprint, currentBound)) {
      const tokenClientSegment =
        typeof decoded.fingerprint === 'string' && decoded.fingerprint.length > 65
          ? decoded.fingerprint.slice(65)
          : null;
      const driftOk = tokenClientSegment && clientHeader && safeEqual(tokenClientSegment, clientHeader);

      if (!driftOk) {
        logSecurityEvent({ level: 'SECURITY', msg: 'Staff fingerprint mismatch', code: 'FINGERPRINT_MISMATCH', req, userId: decoded?.id });
        return res.status(401).json({ success: false, message: 'Device mismatch. Session terminated.', code: 'FINGERPRINT_MISMATCH' });
      }
    }
  }

  let staff;
  try {
    staff = await Staff.findById(decoded.id).select('-password -otpCode -registrationToken -refreshTokens');
  } catch {
    return res.status(503).json({ success: false, message: 'Service temporarily unavailable', code: 'DB_ERROR' });
  }

  if (!staff) return res.status(401).json({ success: false, message: 'Account not found', code: 'USER_NOT_FOUND' });
  if (staff.status !== 'active') return res.status(403).json({ success: false, message: 'Account is not active', code: 'ACCOUNT_INACTIVE' });

  req.staff = staff;
  next();
};

export const issueStaffTokens = async (staff, res, req) => {
  const clientHeader = req?.headers?.['x-device-fingerprint'];
  if (!clientHeader) throw new Error('Device fingerprint header required for staff token issuance.');

  const serverAnchor     = calculateServerAnchor(req);
  const boundFingerprint = `${serverAnchor}-${clientHeader}`;
  const jti              = crypto.randomBytes(16).toString('hex');

  const accessToken = jwt.sign(
    { id: staff._id, role: 'staff', ownerId: staff.ownerId, jti, fingerprint: boundFingerprint },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m', algorithm: 'HS256', issuer: 'bookiify-api', audience: 'bookiify-staff' }
  );

  const refreshToken = crypto.randomBytes(40).toString('hex');
  const refreshHash  = crypto.createHash('sha256').update(refreshToken).digest('hex');
  const expiresAt    = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

  staff.refreshTokens.push({ tokenHash: refreshHash, deviceId: jti, expiresAt });
  if (staff.refreshTokens.length > 5) staff.refreshTokens = staff.refreshTokens.slice(-5);
  staff.lastLogin = new Date();
  await staff.save();

  const cookieOpts = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };
  res.cookie('staffAccessToken',  accessToken,  { ...cookieOpts, maxAge: 15 * 60 * 1000 });
  res.cookie('staffRefreshToken', refreshToken, { ...cookieOpts, maxAge: 7 * 24 * 60 * 60 * 1000 });

  return { accessToken };
};

import { createRequire } from 'module';
const { authenticator } = createRequire(import.meta.url)('otplib/preset-default');
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import User from '../models/User.js';
import { generateAccessAndRefreshTokens, getCookieOptions, getCsrfCookieOptions, hashRefreshToken } from '../utils/tokenService.js';
import { generateCsrfToken } from '../middleware/csrfProtection.js';
import { logSecurityEvent } from '../utils/securityEventLogger.js';

// TOTP window: accept 1 step before/after to allow clock drift
authenticator.options = { window: 1 };

const APP_NAME = 'Bookiify';

/**
 * @desc  Generate a new TOTP secret and return the otpauth URI.
 *        The secret is NOT saved until the user confirms with a valid code.
 * @route GET /api/auth/2fa/setup
 * @access Protected
 */
export const setup2FA = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('+twoFactor.secret');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (user.twoFactor?.enabled) {
      return res.status(400).json({ success: false, message: '2FA is already enabled on this account.' });
    }

    const secret = authenticator.generateSecret(20);
    const otpauthUri = authenticator.keyuri(user.email, APP_NAME, secret);

    // Store the pending secret temporarily in Redis (5 min) so we can verify it without
    // persisting to DB until the user proves they have it configured.
    const { redis } = await import('../config/redis.js');
    await redis.setEx(`2fa:pending:${user._id}`, 5 * 60, secret);

    logSecurityEvent({ level: 'INFO', msg: '2FA setup initiated', code: '2FA_SETUP', req, userId: user._id });

    res.status(200).json({
      success: true,
      data: {
        secret,     // User enters this manually if QR scan fails
        otpauthUri, // Frontend renders this as a QR code
      },
    });
  } catch (err) {
    console.error('[2FA_SETUP]', err.message);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/**
 * @desc  Confirm the pending secret with a valid TOTP code and persist 2FA.
 * @route POST /api/auth/2fa/enable
 * @body  { totpCode }
 * @access Protected
 */
export const enable2FA = async (req, res) => {
  const { totpCode } = req.body;
  if (!totpCode || typeof totpCode !== 'string') {
    return res.status(400).json({ success: false, message: 'TOTP code required.' });
  }

  try {
    const { redis } = await import('../config/redis.js');
    const pendingSecret = await redis.get(`2fa:pending:${req.user._id}`);
    if (!pendingSecret) {
      return res.status(400).json({ success: false, message: 'Setup session expired. Please start 2FA setup again.' });
    }

    const valid = authenticator.verify({ token: totpCode.trim(), secret: pendingSecret });
    if (!valid) {
      return res.status(400).json({ success: false, message: 'Invalid TOTP code. Check your authenticator app.' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'twoFactor.enabled': true,
      'twoFactor.secret':  pendingSecret,
    });

    await redis.del(`2fa:pending:${req.user._id}`);

    logSecurityEvent({ level: 'INFO', msg: '2FA enabled', code: '2FA_ENABLED', req, userId: req.user._id });

    res.status(200).json({ success: true, message: 'Two-factor authentication is now active.' });
  } catch (err) {
    console.error('[2FA_ENABLE]', err.message);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/**
 * @desc  Disable 2FA after verifying the current TOTP code (or password as fallback).
 * @route POST /api/auth/2fa/disable
 * @body  { totpCode } or { password }
 * @access Protected
 */
export const disable2FA = async (req, res) => {
  const { totpCode, password } = req.body;
  if (!totpCode && !password) {
    return res.status(400).json({ success: false, message: 'Provide your TOTP code or account password to disable 2FA.' });
  }

  try {
    const user = await User.findById(req.user._id).select('+twoFactor.secret +password');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (!user.twoFactor?.enabled) {
      return res.status(400).json({ success: false, message: '2FA is not enabled on this account.' });
    }

    let verified = false;

    if (totpCode) {
      verified = authenticator.verify({ token: String(totpCode).trim(), secret: user.twoFactor.secret });
    } else if (password) {
      verified = await bcrypt.compare(password, user.password);
    }

    if (!verified) {
      logSecurityEvent({ level: 'WARN', msg: '2FA disable attempt failed', code: '2FA_DISABLE_FAIL', req, userId: user._id });
      return res.status(401).json({ success: false, message: 'Verification failed. 2FA was not disabled.' });
    }

    await User.findByIdAndUpdate(req.user._id, {
      'twoFactor.enabled': false,
      'twoFactor.secret':  null,
    });

    logSecurityEvent({ level: 'INFO', msg: '2FA disabled', code: '2FA_DISABLED', req, userId: user._id });

    res.status(200).json({ success: true, message: 'Two-factor authentication has been disabled.' });
  } catch (err) {
    console.error('[2FA_DISABLE]', err.message);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/**
 * @desc  Verify a TOTP code after login when 2FA is required.
 *        On success, issues the real access + refresh tokens.
 * @route POST /api/auth/2fa/verify
 * @body  { twoFaToken, totpCode }
 */
export const verify2FA = async (req, res) => {
  const { twoFaToken, totpCode } = req.body;
  if (!twoFaToken || !totpCode) {
    return res.status(400).json({ success: false, message: 'twoFaToken and totpCode are required.' });
  }

  let decoded;
  try {
    decoded = jwt.verify(twoFaToken, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'],
      issuer:     'bookiify-api',
      audience:   'bookiify-2fa',
    });
  } catch {
    return res.status(401).json({ success: false, message: 'Invalid or expired 2FA session. Please log in again.' });
  }

  try {
    const user = await User.findById(decoded.id).select('+twoFactor.secret');
    if (!user || !user.twoFactor?.enabled || !user.twoFactor?.secret) {
      return res.status(401).json({ success: false, message: 'Invalid 2FA state.' });
    }

    const valid = authenticator.verify({ token: String(totpCode).trim(), secret: user.twoFactor.secret });
    if (!valid) {
      logSecurityEvent({ level: 'WARN', msg: '2FA verification failed', code: '2FA_VERIFY_FAIL', req, userId: user._id });
      return res.status(401).json({ success: false, message: 'Invalid authenticator code.' });
    }

    const deviceId = req.headers['x-device-fingerprint'];
    if (!deviceId) {
      return res.status(401).json({ success: false, code: 'FINGERPRINT_REQUIRED', message: 'Security identity not synchronized.' });
    }

    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, req, deviceId);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    user.refreshTokens = (user.refreshTokens || []).filter((rt) => rt.deviceId !== deviceId);
    user.refreshTokens.push({ tokenHash: refreshTokenHash, deviceId, lastKnownIp: req.ip, expiresAt: refreshTokenExpiresAt });
    user.lastLogin = new Date();
    await user.save();

    const cookieOptions = getCookieOptions();
    const csrfToken     = generateCsrfToken();
    res.cookie('csrfToken',    csrfToken,    { ...getCsrfCookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
    res.cookie('accessToken',  accessToken,  { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    logSecurityEvent({ level: 'INFO', msg: '2FA login completed', code: '2FA_LOGIN_OK', req, userId: user._id });

    res.json({
      success: true,
      message: 'Authentication successful',
      csrfToken,
      user: {
        id:            user._id,
        fullName:      user.fullName,
        role:          user.role,
        accountStatus: user.accountStatus,
        businessName:  user.businessName,
        category:      user.category,
      },
    });
  } catch (err) {
    console.error('[2FA_VERIFY]', err.message);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import {
  generateAccessAndRefreshTokens,
  getCookieOptions,
  getCsrfCookieOptions,
  hashRefreshToken
} from '../utils/tokenService.js';
import { revokeToken } from '../middleware/authMiddleware.js';
import { validateSignup, validateLogin } from '../validators/authValidator.js';
import crypto from 'crypto';
import { redis } from '../config/redis.js';
import { generateCsrfToken } from '../middleware/csrfProtection.js';
import { logSecurityEvent } from '../utils/securityEventLogger.js';
import { sendEmail, sendStatusEmail } from '../utils/emailService.js';
import { logActivity } from '../utils/activityLogger.js';

const OTP_TTL_SECONDS = 10 * 60;
const OTP_RATE_LIMIT_SECONDS = 10 * 60;
const MAX_OTP_REQUESTS = 10;
const MAX_LOGIN_FAILURES = 6;
const LOGIN_LOCK_SECONDS = 15 * 60;

const safeEqual = (a, b) => {
  try {
    const ba = Buffer.from(a || '');
    const bb = Buffer.from(b || '');
    return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
  } catch {
    return false;
  }
};

const getClientIp = (req) =>
  req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || 'unknown_ip';

const setCsrfCookie = (res, token) => {
  res.cookie('csrfToken', token, { ...getCsrfCookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
};

/**
 * @desc    Send OTP via email (Brevo)
 */
export const sendOTP = async (req, res) => {
  const { type, target } = req.body;
  if (!type || !target) {
    return res.status(400).json({ success: false, message: 'type and target are required.' });
  }
  if (typeof target !== 'string' || target.length > 200) {
    return res.status(400).json({ success: false, message: 'Invalid target.' });
  }
  try {
    const otpRateKey = `otp:req:${type}:${target}`;
    try {
      const reqCount = await redis.incr(otpRateKey);
      if (reqCount === 1) await redis.expire(otpRateKey, OTP_RATE_LIMIT_SECONDS);
      if (reqCount > MAX_OTP_REQUESTS) {
        return res.status(429).json({ success: false, message: 'Too many OTP requests. Try again later.' });
      }
    } catch { /* Redis unavailable — continue */ }

    const otpCode = crypto.randomBytes(4).toString('hex').toUpperCase(); // 8-char code
    const otpKey = `${type}:${target}`;
    try {
      await redis.setEx(`otp:${otpKey}`, OTP_TTL_SECONDS, otpCode);
    } catch {
      return res.status(503).json({ success: false, message: 'Verification service temporarily unavailable.' });
    }

    if (type === 'email') {
      const { success, error } = await sendEmail({
        to: target,
        subject: 'Bookiify — Your Verification Code',
        html: buildOtpEmail(otpCode),
      });
      if (!success) {
        console.error('[OTP_EMAIL_FAILED]', error);
        return res.status(500).json({ success: false, message: 'Failed to send verification email.' });
      }
    }

    res.status(200).json({ success: true, message: `Verification code sent to ${target}` });
  } catch (err) {
    console.error('[sendOTP]', err.message);
    res.status(500).json({ success: false, message: 'Failed to generate OTP.' });
  }
};

function buildOtpEmail(code) {
  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><style>
  body{margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif}
  .wrap{max-width:560px;margin:40px auto;background:#ffffff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:36px 40px;text-align:center}
  .logo{color:#fff;font-size:26px;font-weight:900;letter-spacing:-1px}
  .logo span{color:#a5b4fc}
  .body{padding:40px}
  .label{font-size:13px;color:#64748b;margin-bottom:6px}
  .title{font-size:22px;font-weight:800;color:#0f172a;margin-bottom:16px}
  .desc{font-size:15px;color:#475569;line-height:1.6;margin-bottom:32px}
  .code-box{background:#f5f3ff;border:2px dashed #a5b4fc;border-radius:16px;padding:28px;text-align:center;margin-bottom:32px}
  .code{font-size:44px;font-weight:900;color:#4f46e5;letter-spacing:10px;font-family:monospace}
  .expire{font-size:12px;color:#94a3b8;margin-top:10px}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;font-size:12px;color:#94a3b8;text-align:center}
</style></head>
<body>
  <div class="wrap">
    <div class="header">
      <div class="logo">BOOKIIFY<span>.</span></div>
    </div>
    <div class="body">
      <div class="label">IDENTITY VERIFICATION</div>
      <div class="title">Your verification code</div>
      <p class="desc">Enter this code to complete your Bookiify registration. Do not share it with anyone.</p>
      <div class="code-box">
        <div class="code">${code}</div>
        <div class="expire">Expires in 10 minutes</div>
      </div>
      <p style="font-size:13px;color:#94a3b8">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div class="footer">&copy; ${new Date().getFullYear()} Bookiify. All rights reserved.</div>
  </div>
</body></html>`;
}

/**
 * @desc    Verify OTP
 */
export const verifyOTP = async (req, res) => {
  const { type, target, code } = req.body;
  if (!type || !target || !code) {
    return res.status(400).json({ success: false, message: 'type, target and code are required.' });
  }

  const otpKey     = `${type}:${target}`;
  const attemptKey = `otp:attempts:${otpKey}`;
  const MAX_OTP_ATTEMPTS = 5;

  // Check brute force attempt counter
  try {
    const attempts = await redis.get(attemptKey);
    if (attempts && parseInt(attempts) >= MAX_OTP_ATTEMPTS) {
      return res.status(429).json({ success: false, message: 'Too many incorrect attempts. Request a new code.' });
    }
  } catch { /* Redis unavailable — continue */ }

  let storedCode = null;
  try {
    storedCode = await redis.get(`otp:${otpKey}`);
  } catch {
    return res.status(503).json({ success: false, message: 'Verification service temporarily unavailable.' });
  }

  // 00000000 accepted as dev bypass until custom domain email is configured
  if (String(code).trim() === '00000000') {
    try { await redis.del(`otp:${otpKey}`); await redis.del(attemptKey); } catch { /* no-op */ }
    return res.status(200).json({ success: true, message: 'Verification successful.' });
  }

  if (!storedCode) {
    return res.status(400).json({ success: false, message: 'Code expired or not requested.' });
  }

  if (!safeEqual(storedCode, code)) {
    try {
      const count = await redis.incr(attemptKey);
      if (count === 1) await redis.expire(attemptKey, OTP_TTL_SECONDS);
    } catch { /* no-op */ }
    return res.status(400).json({ success: false, message: 'Invalid verification code.' });
  }

  // Success — clear OTP and attempt counter
  try {
    await redis.del(`otp:${otpKey}`);
    await redis.del(attemptKey);
  } catch { /* no-op */ }

  res.status(200).json({ success: true, message: 'Verification successful.' });
};

/**
 * @desc    Register a new professional — simplified (KYC submitted later from dashboard)
 */
export const register = async (req, res) => {
  try {
    const { error } = validateSignup(req.body);
    if (error) return res.status(400).json({ success: false, errors: error.details.map(d => d.message) });

    const { email, phone, password, fullName, businessName, category, ville } = req.body;

    const deviceId = req.headers['x-device-fingerprint'];
    if (!deviceId) {
      return res.status(401).json({ success: false, code: 'FINGERPRINT_REQUIRED', message: 'Security Identity not synchronized.' });
    }

    const userExists = await User.findOne({ $or: [{ email: email.toLowerCase() }, { phone }] });
    if (userExists) return res.status(409).json({ success: false, message: 'An account with this email or phone already exists.' });

    const hashedPassword = await bcrypt.hash(password, 14);

    const newUser = await User.create({
      fullName,
      email: email.trim().toLowerCase(),
      phone,
      password: hashedPassword,
      businessName,
      category,
      ville,
      accountStatus: 'pending_kyc',
      kyc: { status: 'none' },
      profilePicUrl: req.files?.profilePic?.[0]?.path || null,
    });

    // Issue session tokens immediately — user is logged in right after signup
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(newUser, req, deviceId);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    newUser.refreshTokens.push({
      tokenHash: refreshTokenHash,
      deviceId,
      lastKnownIp: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
      expiresAt: refreshTokenExpiresAt,
    });
    await newUser.save();

    const cookieOptions = getCookieOptions();
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    logActivity(newUser._id, 'REGISTER', req);

    res.status(201).json({
      success: true,
      csrfToken,
      user: {
        id: newUser._id,
        fullName: newUser.fullName,
        role: newUser.role,
        accountStatus: newUser.accountStatus,
        businessName: newUser.businessName,
        category: newUser.category,
        profilePicUrl: newUser.profilePicUrl,
      },
    });
  } catch (err) {
    console.error('[REGISTER_ERROR]', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'An account with this email or phone already exists.' });
    }
    res.status(500).json({ success: false, message: 'Registration failed. Please try again.' });
  }
};

/**
 * @desc    Login with Triple-Lock Cookie Protection & Unified Identity Binding
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const { error: loginError } = validateLogin({ email, password });
    if (loginError) {
      return res.status(400).json({ success: false, message: "Invalid login payload." });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const lockKey = `auth:lock:${normalizedEmail}`;
    const failKey = `auth:fail:${normalizedEmail}`;

    try {
      const locked = await redis.get(lockKey);
      if (locked) {
        logSecurityEvent({
          level: 'SECURITY',
          msg: 'Temporary auth lock hit',
          code: 'AUTH_TEMP_LOCK',
          req,
          meta: { email: normalizedEmail },
        });
        return res.status(429).json({
          success: false,
          code: 'AUTH_TEMP_LOCK',
          message: "Too many failed attempts. Try again later.",
        });
      }
    } catch {
      // Continue even if Redis unavailable.
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      try {
        const failures = await redis.incr(failKey);
        if (failures === 1) await redis.expire(failKey, LOGIN_LOCK_SECONDS);
        if (failures >= MAX_LOGIN_FAILURES) {
          await redis.setEx(lockKey, LOGIN_LOCK_SECONDS, '1');
        }
      } catch {
        // no-op
      }
      logSecurityEvent({
        level: 'WARN',
        msg: 'Login failed: user not found',
        code: 'LOGIN_FAILED',
        req,
        meta: { email: normalizedEmail },
      });
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({ success: false, message: "Account suspended. Contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      try {
        const failures = await redis.incr(failKey);
        if (failures === 1) await redis.expire(failKey, LOGIN_LOCK_SECONDS);
        if (failures >= MAX_LOGIN_FAILURES) {
          await redis.setEx(lockKey, LOGIN_LOCK_SECONDS, '1');
        }
      } catch {
        // no-op
      }
      logSecurityEvent({
        level: 'WARN',
        msg: 'Login failed: invalid password',
        code: 'LOGIN_FAILED',
        req,
        userId: user._id,
        meta: { email: normalizedEmail },
      });
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const deviceId = req.headers['x-device-fingerprint'];

    if (!deviceId) {
      return res.status(401).json({
        success: false,
        code: 'FINGERPRINT_REQUIRED',
        message: "Security Identity not synchronized. Retrying...",
      });
    }

    // 2FA gate: if enabled, issue a short-lived temp token and return early
    if (user.twoFactor?.enabled) {
      const twoFaToken = jwt.sign(
        { id: user._id },
        process.env.JWT_ACCESS_SECRET,
        { expiresIn: '5m', algorithm: 'HS256', issuer: 'bookiify-api', audience: 'bookiify-2fa' }
      );
      return res.json({ success: true, requires2FA: true, twoFaToken });
    }

    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, req, deviceId);
    const refreshTokenHash = hashRefreshToken(refreshToken);

    user.refreshTokens = user.refreshTokens.filter((rt) => {
      const hasTokenMaterial = !!rt.tokenHash || !!rt.token;
      return hasTokenMaterial && rt.deviceId !== deviceId;
    });
    user.refreshTokens.push({
      tokenHash: refreshTokenHash,
      deviceId,
      lastKnownIp: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
      expiresAt: refreshTokenExpiresAt
    });

    user.lastLogin = Date.now();
    await user.save();

    // 🛡️ UPDATE: Apply the central cookie policy to fix cross-domain blocking
    const cookieOptions = getCookieOptions();
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
    try {
      await redis.del(failKey);
      await redis.del(lockKey);
    } catch {
      // no-op
    }

    logActivity(user._id, 'LOGIN_SUCCESS', req);

    res.json({
      success: true,
      message: "Authentication successful",
      csrfToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        accountStatus: user.accountStatus,
        businessName: user.businessName,
        category: user.category,
      }
    });
  } catch (err) {
    console.error(`[AUTH_CONTROLLER_ERROR]: ${err.message}`);
    res.status(500).json({ success: false, message: "Login failed" });
  }
};

/**
 * @desc    Refresh Access Token: Implements Rotation & Unified Binding
 */
export const refresh = async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken;
  if (!incomingRefreshToken) return res.status(401).json({ success: false, message: "Session expired" });

  try {
    const incomingRefreshTokenHash = hashRefreshToken(incomingRefreshToken);
    const user = await User.findOne({
      $or: [
        { "refreshTokens.tokenHash": incomingRefreshTokenHash },
        { "refreshTokens.token": incomingRefreshToken } // legacy fallback
      ]
    });
    
    // 🛡️ UPDATE: Use policy for clearing cookies
    const cookieOptions = getCookieOptions();

    if (!user || user.accountStatus === 'suspended') {
        res.clearCookie('refreshToken', cookieOptions);
        res.clearCookie('accessToken', cookieOptions);
        return res.status(403).json({ success: false, message: "Security Alert: Access Revoked" });
    }

    const matchedStoredToken = user.refreshTokens.find((rt) =>
      (rt.tokenHash && safeEqual(rt.tokenHash, incomingRefreshTokenHash)) ||
      (rt.token && safeEqual(rt.token, incomingRefreshToken))
    );

    if (!matchedStoredToken) {
      res.clearCookie('refreshToken', cookieOptions);
      res.clearCookie('accessToken', cookieOptions);
      return res.status(403).json({ success: false, message: "Could not refresh session" });
    }

    const deviceId = req.headers['x-device-fingerprint']; 
    
    if (!deviceId) {
       return res.status(401).json({ 
         success: false, 
         code: 'FINGERPRINT_REQUIRED', 
         message: "Security Identity not synchronized." 
       });
    }

    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, req, deviceId);
    const newRefreshTokenHash = hashRefreshToken(refreshToken);

    user.refreshTokens = user.refreshTokens.filter((rt) => {
      if (rt.tokenHash) return !safeEqual(rt.tokenHash, incomingRefreshTokenHash);
      if (rt.token) return !safeEqual(rt.token, incomingRefreshToken);
      return true;
    });
    user.refreshTokens.push({
      tokenHash: newRefreshTokenHash,
      deviceId,
      lastKnownIp: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
      expiresAt: refreshTokenExpiresAt
    });
    await user.save();

    // 🛡️ UPDATE: Consistently apply policy during rotation
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);
    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
    
    res.json({ success: true, message: "Session extended", csrfToken });
  } catch (err) {
    res.status(403).json({ success: false, message: "Could not refresh session" });
  }
};

/**
 * @desc    Logout: Revokes Token in Redis & Clears Cookies
 */
export const logout = async (req, res) => {
  try {
    const token = req.cookies.accessToken;

    if (token) {
      await revokeToken(token);
    }

    const refreshToken = req.cookies.refreshToken;
    if (refreshToken) {
      const refreshTokenHash = hashRefreshToken(refreshToken);
      await User.updateOne(
        { _id: req.user._id },
        {
          $pull: {
            refreshTokens: {
              $or: [
                { tokenHash: refreshTokenHash },
                { token: refreshToken } // legacy fallback
              ]
            }
          }
        }
      );
    }

    const cookieOptions = getCookieOptions();
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('csrfToken', getCsrfCookieOptions());

    logActivity(req.user._id, 'LOGOUT', req);

    res.status(200).json({ success: true, message: "Securely logged out" });
  } catch (err) {
    res.status(500).json({ success: false, message: "Logout failed" });
  }
};

/**
 * @desc    Verify Me: High-security DB check
 */
export const verifyMe = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('-password -refreshTokens');
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
      csrfToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role,
        accountStatus: user.accountStatus,
        businessName: user.businessName,
        kycStatus: user.kyc?.status,
        trialEndsAt: user.paymentInfo?.subscription?.trialEndsAt ?? null,
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Verification failed" });
  }
};

/**
 * @desc  Forgot Password — generate a reset token and email it
 * @route POST /api/auth/forgot-password
 */
export const forgotPassword = async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string' || email.length > 200) {
    return res.status(400).json({ success: false, message: 'Valid email required.' });
  }

  // Always return 200 to prevent email enumeration
  const genericOk = () =>
    res.status(200).json({ success: true, message: 'If that email exists, a reset link has been sent.' });

  try {
    const user = await User.findOne({ email: email.trim().toLowerCase() }).select('+passwordResetToken +passwordResetExpires');
    if (!user) return genericOk();

    // Generate a cryptographically strong token
    const rawToken  = crypto.randomBytes(32).toString('hex');
    const tokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    user.passwordResetToken   = tokenHash;
    user.passwordResetExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
    await user.save();

    const resetUrl = `${process.env.CLIENT_URL}/reset-password?token=${rawToken}`;
    const escName  = user.fullName.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

    await sendEmail({
      to: user.email,
      subject: 'Bookiify — Reset Your Password',
      html: `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><style>
  body{margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif}
  .wrap{max-width:560px;margin:40px auto;background:#fff;border-radius:20px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:36px 40px;text-align:center}
  .logo{color:#fff;font-size:26px;font-weight:900;letter-spacing:-1px}
  .logo span{color:#a5b4fc}
  .body{padding:40px}
  .title{font-size:22px;font-weight:800;color:#0f172a;margin-bottom:16px}
  .desc{font-size:15px;color:#475569;line-height:1.6;margin-bottom:32px}
  .btn{display:block;text-align:center;background:#4f46e5;color:#fff;text-decoration:none;font-weight:800;font-size:14px;padding:18px 32px;border-radius:16px;margin:0 auto 24px}
  .warn{font-size:12px;color:#94a3b8;text-align:center}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;font-size:12px;color:#94a3b8;text-align:center}
</style></head>
<body>
  <div class="wrap">
    <div class="header"><div class="logo">BOOKIIFY<span>.</span></div></div>
    <div class="body">
      <div class="title">Password Reset Request</div>
      <p class="desc">Hello <strong>${escName}</strong>, we received a request to reset your Bookiify password. Click the button below — this link expires in <strong>15 minutes</strong>.</p>
      <a href="${resetUrl}" class="btn">RESET MY PASSWORD</a>
      <p class="warn">If you didn't request this, you can safely ignore this email. Your password will not change.</p>
    </div>
    <div class="footer">&copy; ${new Date().getFullYear()} Bookiify. All rights reserved.</div>
  </div>
</body></html>`,
    });

    logSecurityEvent({ level: 'INFO', msg: 'Password reset requested', code: 'PWD_RESET_REQUEST', req, userId: user._id });
    return genericOk();
  } catch (err) {
    console.error('[FORGOT_PASSWORD]', err.message);
    return res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/**
 * @desc  Reset Password — verify token and set new password
 * @route POST /api/auth/reset-password
 */
export const resetPassword = async (req, res) => {
  const { token, password } = req.body;
  if (!token || typeof token !== 'string' || token.length !== 64) {
    return res.status(400).json({ success: false, message: 'Invalid or missing reset token.' });
  }
  if (!password || typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return res.status(400).json({ success: false, message: 'Password must be 8–128 characters.' });
  }

  try {
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');

    const user = await User.findOne({
      passwordResetToken:   tokenHash,
      passwordResetExpires: { $gt: new Date() },
    }).select('+passwordResetToken +passwordResetExpires');

    if (!user) {
      return res.status(400).json({ success: false, message: 'Reset link is invalid or has expired.' });
    }

    const salt = await bcrypt.genSalt(14);
    user.password             = await bcrypt.hash(password, salt);
    user.passwordResetToken   = undefined;
    user.passwordResetExpires = undefined;
    // Invalidate all existing sessions
    user.refreshTokens = [];
    await user.save();

    logSecurityEvent({ level: 'INFO', msg: 'Password reset completed', code: 'PWD_RESET_DONE', req, userId: user._id });
    res.status(200).json({ success: true, message: 'Password updated. Please log in.' });
  } catch (err) {
    console.error('[RESET_PASSWORD]', err.message);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/**
 * @desc    Admin: Review KYC/Account
 */
export const reviewUser = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    if (action === 'approve') {
      user.accountStatus = 'active';
      user.kyc.status = 'verified';
      user.kyc.verifiedAt = Date.now();
      user.paymentInfo.subscription.trialEndsAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
      user.paymentInfo.subscription.plan = 'free_trial';
      user.markModified('paymentInfo');
    } else if (action === 'reject') {
      user.accountStatus = 'on_boarding';
      user.kyc.status = 'rejected';
      user.kyc.rejectionReason = reason || "Documents did not meet requirements.";
    } else {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    await user.save();

    sendStatusEmail(
      user.email,
      user.fullName,
      action === 'approve' ? 'active' : 'rejected',
      reason || ''
    ).catch(() => {});

    res.json({ success: true, message: `User account has been ${action}ed successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Review update failed" });
  }
};
import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { 
  generateAccessAndRefreshTokens,
  getCookieOptions, // 🛡️ Import the central cookie policy
  getCsrfCookieOptions,
  hashRefreshToken
} from '../utils/tokenService.js';
import { revokeToken } from '../middleware/authMiddleware.js'; 
import { validateSignup, validateLogin } from '../validators/authValidator.js';
import crypto from 'crypto';
import { redis } from '../config/redis.js';
import { generateCsrfToken } from '../middleware/csrfProtection.js';

const otpStore = new Map();
const OTP_TTL_SECONDS = 10 * 60;
const OTP_RATE_LIMIT_SECONDS = 10 * 60;
const MAX_OTP_REQUESTS = 5;
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
 * @desc    Send OTP to Terminal for Testing
 */
export const sendOTP = async (req, res) => {
  const { type, target } = req.body;
  try {
    const otpRateKey = `otp:req:${type}:${target}`;
    try {
      const reqCount = await redis.incr(otpRateKey);
      if (reqCount === 1) {
        await redis.expire(otpRateKey, OTP_RATE_LIMIT_SECONDS);
      }
      if (reqCount > MAX_OTP_REQUESTS) {
        return res.status(429).json({ success: false, message: "Too many OTP requests. Try again later." });
      }
    } catch {
      // Keep compatibility if Redis is temporarily unavailable.
    }

    const otpCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    const otpKey = `${type}:${target}`;
    otpStore.set(otpKey, {
      code: otpCode,
      expires: Date.now() + OTP_TTL_SECONDS * 1000
    });
    try {
      await redis.setEx(`otp:${otpKey}`, OTP_TTL_SECONDS, otpCode);
    } catch {
      // Keep local fallback store active.
    }

    console.log(`
    ╔════════════════════════════════════════════════════════════╗
    ║          🔥 BOOKIIFY DEVELOPMENT VAULT 🔥                 ║
    ╠════════════════════════════════════════════════════════════╣
    ║  TYPE:   ${type.toUpperCase().padEnd(49)} ║
    ║  TARGET: ${target.padEnd(49)} ║
    ║  CODE:   ${otpCode.padEnd(49)} ║
    ╚════════════════════════════════════════════════════════════╝
    `);

    res.status(200).json({ success: true, message: `OTP sent to ${target} (Check Terminal)` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Failed to generate OTP" });
  }
};

/**
 * @desc    Verify OTP
 */
export const verifyOTP = async (req, res) => {
  const { type, target, code } = req.body;
  const otpKey = `${type}:${target}`;
  let storedCode = null;
  try {
    storedCode = await redis.get(`otp:${otpKey}`);
  } catch {
    storedCode = null;
  }

  if (!storedCode) {
    const fallback = otpStore.get(otpKey);
    if (!fallback) return res.status(400).json({ success: false, message: "OTP expired or not requested" });
    if (Date.now() > fallback.expires) {
      otpStore.delete(otpKey);
      return res.status(400).json({ success: false, message: "OTP has expired" });
    }
    storedCode = fallback.code;
  }

  if (!safeEqual(storedCode, code)) return res.status(400).json({ success: false, message: "Invalid verification code" });
  otpStore.delete(otpKey);
  try {
    await redis.del(`otp:${otpKey}`);
  } catch {
    // no-op
  }
  res.status(200).json({ success: true, message: "Verification successful" });
};

/**
 * @desc    Register a new professional
 */
export const register = async (req, res) => {
  try {
    const { error } = validateSignup(req.body);
    if (error) return res.status(400).json({ success: false, errors: error.details.map(d => d.message) });

    const { email, phone, password, fullName, businessName, category, ville } = req.body;

    const userExists = await User.findOne({ $or: [{ email }, { phone }] });
    if (userExists) return res.status(409).json({ success: false, message: "User with this email or phone already exists" });

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    const newUser = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      businessName,
      category,
      ville,
      accountStatus: 'review', 
      onboardingStep: 5,
      kyc: {
        idFrontUrl: req.files?.idFront ? req.files.idFront[0].path : null,
        idBackUrl: req.files?.idBack ? req.files.idBack[0].path : null,
        livePhotoUrl: req.files?.livenessVideo ? req.files.livenessVideo[0].path : null,
        status: 'pending'
      },
      profilePicUrl: req.files?.profilePic ? req.files.profilePic[0].path : null
    });

    res.status(201).json({ 
      success: true,
      message: "Application submitted successfully. Review expected within 24h.",
      userId: newUser._id 
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Server Error during registration", error: err.message });
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
    const ip = getClientIp(req);
    const lockKey = `auth:lock:${normalizedEmail}:${ip}`;
    const failKey = `auth:fail:${normalizedEmail}:${ip}`;

    try {
      const locked = await redis.get(lockKey);
      if (locked) {
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
      return res.status(401).json({ success: false, message: "Invalid credentials" });
    }

    const deviceId = req.headers['x-device-fingerprint']; 

    if (!deviceId) {
       return res.status(401).json({ 
         success: false, 
         code: 'FINGERPRINT_REQUIRED', 
         message: "Security Identity not synchronized. Retrying..." 
       });
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

    // 🛡️ UPDATE: Use policy for secure cookie clearing
    const cookieOptions = getCookieOptions();
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);
    res.clearCookie('csrfToken', getCsrfCookieOptions());

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
        businessName: user.businessName
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, message: "Verification failed" });
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
    } else if (action === 'reject') {
      user.accountStatus = 'on_boarding'; 
      user.kyc.status = 'rejected';
      user.kyc.rejectionReason = reason || "Documents did not meet requirements.";
    } else {
      return res.status(400).json({ success: false, message: "Invalid action" });
    }

    await user.save();
    res.json({ success: true, message: `User account has been ${action}ed successfully.` });
  } catch (err) {
    res.status(500).json({ success: false, message: "Review update failed" });
  }
};
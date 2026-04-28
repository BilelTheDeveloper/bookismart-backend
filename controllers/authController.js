import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { 
  generateAccessAndRefreshTokens 
} from '../utils/tokenService.js';
import { revokeToken } from '../middleware/authMiddleware.js'; 
import { validateSignup } from '../validators/authValidator.js';
import crypto from 'crypto';

const otpStore = new Map();

/**
 * @desc    Send OTP to Terminal for Testing
 */
export const sendOTP = async (req, res) => {
  const { type, target } = req.body;
  try {
    const otpCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    otpStore.set(`${type}:${target}`, {
      code: otpCode,
      expires: Date.now() + 10 * 60 * 1000
    });

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
  const storedData = otpStore.get(`${type}:${target}`);

  if (!storedData) return res.status(400).json({ success: false, message: "OTP expired or not requested" });
  if (storedData.code !== code) return res.status(400).json({ success: false, message: "Invalid verification code" });
  if (Date.now() > storedData.expires) {
    otpStore.delete(`${type}:${target}`);
    return res.status(400).json({ success: false, message: "OTP has expired" });
  }

  otpStore.delete(`${type}:${target}`);
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
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ success: false, message: "Invalid credentials" });

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({ success: false, message: "Account suspended. Contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ success: false, message: "Invalid credentials" });

    // 🛡️ IDENTITY GATE SYNC: Use client header for initial binding
    const deviceId = req.headers['x-device-fingerprint']; 

    /**
     * UPDATE: If deviceId is missing, we return 401 FINGERPRINT_REQUIRED.
     * This allows the frontend interceptor to retry the request once the fingerprint is ready.
     */
    if (!deviceId) {
       return res.status(401).json({ 
         success: false, 
         code: 'FINGERPRINT_REQUIRED', 
         message: "Security Identity not synchronized. Retrying..." 
       });
    }
    
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, req, deviceId);

    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);
    user.refreshTokens.push({
      token: refreshToken,
      deviceId,
      lastKnownIp: req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress,
      expiresAt: refreshTokenExpiresAt
    });

    user.lastLogin = Date.now();
    await user.save();

    const cookieOptions = {
      httpOnly: true,
      secure: true, 
      sameSite: 'none',
    };

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });

    res.json({
      success: true,
      message: "Authentication successful",
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
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
    const user = await User.findOne({ "refreshTokens.token": incomingRefreshToken });
    
    if (!user || user.accountStatus === 'suspended') {
        const clearOpt = { httpOnly: true, secure: true, sameSite: 'none' };
        res.clearCookie('refreshToken', clearOpt);
        res.clearCookie('accessToken', clearOpt);
        return res.status(403).json({ success: false, message: "Security Alert: Access Revoked" });
    }

    // 🛡️ IDENTITY GATE SYNC
    const deviceId = req.headers['x-device-fingerprint']; 
    
    /**
     * UPDATE: Same logic for refresh to handle race conditions during token rotation.
     */
    if (!deviceId) {
       return res.status(401).json({ 
         success: false, 
         code: 'FINGERPRINT_REQUIRED', 
         message: "Security Identity not synchronized." 
       });
    }

    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, req, deviceId);

    user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== incomingRefreshToken);
    user.refreshTokens.push({ token: refreshToken, deviceId, expiresAt: refreshTokenExpiresAt });
    await user.save();

    const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none' };

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
    
    res.json({ success: true, message: "Session extended" });
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
        await User.updateOne(
            { "refreshTokens.token": refreshToken },
            { $pull: { refreshTokens: { token: refreshToken } } }
        );
    }

    const cookieOptions = { httpOnly: true, secure: true, sameSite: 'none' };
    res.clearCookie('accessToken', cookieOptions);
    res.clearCookie('refreshToken', cookieOptions);

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

    if (!user) return res.status(404).json({ success: false, message: "User not found" });

    res.status(200).json({
      success: true,
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
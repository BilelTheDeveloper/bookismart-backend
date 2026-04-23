import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { 
  generateAccessAndRefreshTokens 
} from '../utils/tokenService.js';
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
    ║        🔥 BOOKIIFY DEVELOPMENT VAULT 🔥              ║
    ╠════════════════════════════════════════════════════════════╣
    ║  TYPE:   ${type.toUpperCase().padEnd(49)} ║
    ║  TARGET: ${target.padEnd(49)} ║
    ║  CODE:   ${otpCode.padEnd(49)} ║
    ╚════════════════════════════════════════════════════════════╝
    `);

    res.status(200).json({ message: `OTP sent to ${target} (Check Terminal)` });
  } catch (err) {
    res.status(500).json({ message: "Failed to generate OTP" });
  }
};

/**
 * @desc    Verify OTP
 */
export const verifyOTP = async (req, res) => {
  const { type, target, code } = req.body;
  const storedData = otpStore.get(`${type}:${target}`);

  if (!storedData) return res.status(400).json({ message: "OTP expired or not requested" });
  if (storedData.code !== code) return res.status(400).json({ message: "Invalid verification code" });
  if (Date.now() > storedData.expires) {
    otpStore.delete(`${type}:${target}`);
    return res.status(400).json({ message: "OTP has expired" });
  }

  otpStore.delete(`${type}:${target}`);
  res.status(200).json({ message: "Verification successful" });
};

/**
 * @desc    Register a new professional
 */
export const register = async (req, res) => {
  try {
    const { error } = validateSignup(req.body);
    if (error) return res.status(400).json({ errors: error.details.map(d => d.message) });

    const { email, phone, password, fullName, businessName, category, ville } = req.body;

    const userExists = await User.findOne({ $or: [{ email }, { phone }] });
    if (userExists) return res.status(409).json({ message: "User with this email or phone already exists" });

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
      message: "Application submitted successfully. Review expected within 24h.",
      userId: newUser._id 
    });
  } catch (err) {
    res.status(500).json({ message: "Server Error during registration", error: err.message });
  }
};

/**
 * @desc    Login with Triple-Lock Cookie Protection
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    if (user.accountStatus === 'suspended') {
      return res.status(403).json({ message: "Your account has been suspended. Contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const deviceId = req.deviceFingerprint; 
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, deviceId);

    // Filter and update tokens
    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);
    user.refreshTokens.push({
      token: refreshToken,
      deviceId,
      lastKnownIp: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
      expiresAt: refreshTokenExpiresAt
    });

    user.lastLogin = Date.now();
    await user.save();

    const cookieOptions = {
      httpOnly: true,
      secure: true, 
      sameSite: 'none',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    };

    res.cookie('accessToken', accessToken, { 
      ...cookieOptions, 
      maxAge: 15 * 60 * 1000 
    });

    res.cookie('refreshToken', refreshToken, cookieOptions);

    res.json({
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
    res.status(500).json({ message: "Login failed", error: err.message });
  }
};

/**
 * @desc    Admin: Approve or Reject KYC/Account
 */
export const reviewUser = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (action === 'approve') {
      user.accountStatus = 'active';
      user.kyc.status = 'verified';
      user.kyc.verifiedAt = Date.now();
    } else if (action === 'reject') {
      user.accountStatus = 'on_boarding'; 
      user.kyc.status = 'rejected';
      user.kyc.rejectionReason = reason || "Documents did not meet requirements.";
    } else {
      return res.status(400).json({ message: "Invalid action" });
    }

    await user.save();
    res.json({ message: `User account has been ${action}ed successfully.` });
  } catch (err) {
    res.status(500).json({ message: "Review update failed" });
  }
};

/**
 * @desc    Refresh Access Token using HttpOnly Cookies
 */
export const refresh = async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken;
  if (!incomingRefreshToken) return res.status(401).json({ message: "Session expired" });

  try {
    const user = await User.findOne({ "refreshTokens.token": incomingRefreshToken });
    
    if (!user) {
        res.clearCookie('refreshToken');
        res.clearCookie('accessToken');
        return res.status(403).json({ message: "Security Alert: Invalid Refresh Attempt" });
    }

    const deviceId = req.deviceFingerprint; 
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, deviceId);

    user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== incomingRefreshToken);
    user.refreshTokens.push({ token: refreshToken, deviceId, expiresAt: refreshTokenExpiresAt });
    await user.save();

    const cookieOptions = {
      httpOnly: true,
      secure: true,
      sameSite: 'none'
    };

    res.cookie('accessToken', accessToken, { ...cookieOptions, maxAge: 15 * 60 * 1000 });
    res.cookie('refreshToken', refreshToken, { ...cookieOptions, maxAge: 7 * 24 * 60 * 60 * 1000 });
    
    res.json({ message: "Session extended" });
  } catch (err) {
    res.status(403).json({ message: "Could not refresh session" });
  }
};

/**
 * @desc    Logout: Clear all secure cookies
 */
export const logout = async (req, res) => {
  res.clearCookie('accessToken', { httpOnly: true, secure: true, sameSite: 'none' });
  res.clearCookie('refreshToken', { httpOnly: true, secure: true, sameSite: 'none' });
  res.status(200).json({ message: "Logged out successfully" });
};

/**
 * 🛡️ ULTRA-SECURE VERIFICATION ENDPOINT
 * @desc    Get real-time user data from DB using secure cookie
 * @route   GET /api/auth/verify-me
 * @access  Private
 */
export const verifyMe = async (req, res) => {
  try {
    // req.user is attached by the 'protect' middleware
    const user = await User.findById(req.user._id).select('-password -refreshTokens');

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.status(200).json({
      success: true,
      user: {
        id: user._id,
        fullName: user.fullName,
        email: user.email,
        role: user.role, // Truth from DB
        accountStatus: user.accountStatus,
        businessName: user.businessName
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Verification failed", error: err.message });
  }
};
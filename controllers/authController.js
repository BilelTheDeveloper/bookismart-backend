import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { 
  generateAccessAndRefreshTokens, 
  createDeviceFingerprint 
} from '../utils/tokenService.js';
import { validateSignup } from '../validators/authValidator.js';
import crypto from 'crypto';

// Temporary In-Memory Store for OTPs (In Production, use Redis)
const otpStore = new Map();

/**
 * @desc    Send OTP to Terminal for Testing (Step 2)
 */
export const sendOTP = async (req, res) => {
  const { type, target } = req.body; // type: 'email' or 'phone'

  try {
    // Generate an 8-character secure alphanumeric code
    const otpCode = crypto.randomBytes(4).toString('hex').toUpperCase();
    
    // Store it for 10 minutes
    otpStore.set(`${type}:${target}`, {
      code: otpCode,
      expires: Date.now() + 10 * 60 * 1000
    });

    // 🚀 TEST MODE: Log to Terminal
    console.log(`
    ╔════════════════════════════════════════════════════════════╗
    ║              🔥 BOOKIIFY DEVELOPMENT VAULT 🔥              ║
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

  if (!storedData) {
    return res.status(400).json({ message: "OTP expired or not requested" });
  }

  if (storedData.code !== code) {
    return res.status(400).json({ message: "Invalid verification code" });
  }

  if (Date.now() > storedData.expires) {
    otpStore.delete(`${type}:${target}`);
    return res.status(400).json({ message: "OTP has expired" });
  }

  // Success: Clear the OTP from memory
  otpStore.delete(`${type}:${target}`);
  res.status(200).json({ message: "Verification successful" });
};

/**
 * @desc    Register a new professional (The 5-Step Finalization)
 * @route   POST /api/auth/register
 * @access  Public
 */
export const register = async (req, res) => {
  try {
    // 1. Server-Side Validation (The Shield)
    const { error } = validateSignup(req.body);
    if (error) return res.status(400).json({ errors: error.details.map(d => d.message) });

    const { email, phone, password, fullName, businessName, category, ville } = req.body;

    // 2. Check for existing users (Email or Phone)
    const userExists = await User.findOne({ $or: [{ email }, { phone }] });
    if (userExists) return res.status(409).json({ message: "User with this email or phone already exists" });

    // 3. Hash Password (Bcrypt + Salt)
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 4. Create User in 'review' status
    const newUser = await User.create({
      fullName,
      email,
      phone,
      password: hashedPassword,
      businessName,
      category,
      ville,
      accountStatus: 'review', // Admin must review
      onboardingStep: 5,
      kyc: {
        idFrontUrl: req.files?.idFront ? req.files.idFront[0].path : null,
        idBackUrl: req.files?.idBack ? req.files.idBack[0].path : null,
        // UPDATE: Changed livenessVideoUrl to livePhotoUrl to match your User Model
        livePhotoUrl: req.files?.livenessVideo ? req.files.livenessVideo[0].path : null,
        status: 'pending'
      }
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
 * @desc    Login & Issue Dual-Tokens with Fingerprinting
 * @route   POST /api/auth/login
 * @access  Public
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    // Create Device Fingerprint (Device Tracking)
    const deviceId = createDeviceFingerprint(req);
    const ip = req.ip;

    // Generate New Tokens
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, deviceId);

    // 5. Token Rotation Logic
    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);
    user.refreshTokens.push({
      token: refreshToken,
      deviceId,
      lastKnownIp: ip,
      expiresAt: refreshTokenExpiresAt
    });

    user.lastLogin = Date.now();
    await user.save();

    // 6. Set HttpOnly Cookie
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 Days
    });

    res.json({
      accessToken,
      user: {
        id: user._id,
        fullName: user.fullName,
        role: user.role,
        accountStatus: user.accountStatus
      }
    });
  } catch (err) {
    res.status(500).json({ message: "Login failed" });
  }
};

/**
 * @desc    Refresh Access Token
 * @route   POST /api/auth/refresh
 * @access  Public
 */
export const refresh = async (req, res) => {
  const incomingRefreshToken = req.cookies.refreshToken;
  if (!incomingRefreshToken) return res.status(401).json({ message: "Session expired" });

  try {
    const user = await User.findOne({ "refreshTokens.token": incomingRefreshToken });
    
    if (!user) {
        res.clearCookie('refreshToken');
        return res.status(403).json({ message: "Security Alert: Invalid Refresh Attempt" });
    }

    const deviceId = createDeviceFingerprint(req);
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, deviceId);

    user.refreshTokens = user.refreshTokens.filter(rt => rt.token !== incomingRefreshToken);
    user.refreshTokens.push({ token: refreshToken, deviceId, expiresAt: refreshTokenExpiresAt });
    await user.save();

    res.cookie('refreshToken', refreshToken, { httpOnly: true, secure: true, sameSite: 'strict' });
    res.json({ accessToken });
  } catch (err) {
    res.status(403).json({ message: "Could not refresh session" });
  }
};
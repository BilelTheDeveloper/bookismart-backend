import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import { 
  generateAccessAndRefreshTokens, 
  createDeviceFingerprint 
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
 * @desc    Register a new professional (The 5-Step Finalization)
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
      // --- UPDATED KYC MAPPING ---
      kyc: {
        idFrontUrl: req.files?.idFront ? req.files.idFront[0].path : null,
        idBackUrl: req.files?.idBack ? req.files.idBack[0].path : null,
        livePhotoUrl: req.files?.livenessVideo ? req.files.livenessVideo[0].path : null,
        status: 'pending'
      },
      // Save profile picture URL if it exists
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
 * @desc    Login with Status Protection
 */
export const login = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message: "Invalid credentials" });

    // Block login if account is not active
    if (user.accountStatus === 'review') {
      return res.status(403).json({ message: "Your account is under review. Please wait for admin approval." });
    }
    if (user.accountStatus === 'suspended') {
      return res.status(403).json({ message: "Your account has been suspended. Contact support." });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ message: "Invalid credentials" });

    const deviceId = createDeviceFingerprint(req);
    const { accessToken, refreshToken, refreshTokenExpiresAt } = await generateAccessAndRefreshTokens(user, deviceId);

    user.refreshTokens = user.refreshTokens.filter(rt => rt.deviceId !== deviceId);
    user.refreshTokens.push({
      token: refreshToken,
      deviceId,
      lastKnownIp: req.ip,
      expiresAt: refreshTokenExpiresAt
    });

    user.lastLogin = Date.now();
    await user.save();

    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000
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
 * @desc    Admin: Approve or Reject KYC/Account
 * @route   PATCH /api/auth/review-user/:id
 */
export const reviewUser = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body; // action: 'approve' or 'reject'

  try {
    const user = await User.findById(id);
    if (!user) return res.status(404).json({ message: "User not found" });

    if (action === 'approve') {
      user.accountStatus = 'active';
      user.kyc.status = 'verified';
      user.kyc.verifiedAt = Date.now();
    } else if (action === 'reject') {
      user.accountStatus = 'on_boarding'; // Send them back to onboarding or keep in review
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
 * @desc    Refresh Access Token
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
import express from 'express';
import rateLimit from 'express-rate-limit';
const router = express.Router();

// 1. Controllers
import {
  register,
  login,
  refresh,
  sendOTP,
  verifyOTP,
  logout,
  verifyMe,
  forgotPassword,
  resetPassword,
} from '../controllers/authController.js';

// 2. Middlewares
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js';
import { setup2FA, enable2FA, disable2FA, verify2FA } from '../controllers/twoFactorController.js';

/**
 * 🛡️ AUTH-SPECIFIC RATE LIMITING
 * Prevents brute-force attacks on sensitive endpoints.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 20, // Limit each IP to 20 requests per window
  message: { message: "Too many login attempts, please try again after 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const refreshLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  message: { message: "Too many refresh attempts. Please login again." },
  standardHeaders: true,
  legacyHeaders: false,
});

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC ROUTES
   ───────────────────────────────────────────────────────────────────────────── */

// 1. OTP Verification - Added authLimiter to prevent SMS/Email spam
router.post('/send-otp', authLimiter, sendOTP);
router.post('/verify-otp', authLimiter, verifyOTP);

// 2. Registration — profile picture only (KYC submitted later from dashboard)
router.post('/register', upload.fields([
    { name: 'profilePic', maxCount: 1 }
]), register);

// 3. Secure Login - Added authLimiter to prevent password guessing
router.post('/login', authLimiter, login);

// 3b. Password Reset (rate-limited — same window as auth)
router.post('/forgot-password', authLimiter, forgotPassword);
router.post('/reset-password',  authLimiter, resetPassword);

// 4. Silent Token Refresh (Uses HttpOnly Cookie Rotation)
router.post('/refresh', refreshLimiter, refresh);

/* ─────────────────────────────────────────────────────────────────────────────
   PROTECTED ROUTES
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * 🛡️ THE TRUTH ENDPOINT: /verify-me
 * Verifies: JWT + Redis Blacklist + Device Fingerprint match
 */
router.get('/verify-me', protect, verifyMe);

/**
 * 🛡️ SECURE LOGOUT
 * Identified by 'protect' to allow the JTI to be blacklisted in Redis.
 */
router.post('/logout', protect, logout);

/**
 * 🔐 2FA ROUTES
 */
// Step 1 of setup — generates pending secret (protected)
router.get('/2fa/setup',   protect, setup2FA);
// Step 2 of setup — confirms secret with first code (protected)
router.post('/2fa/enable',  protect, enable2FA);
// Disable 2FA with current TOTP code or password (protected)
router.post('/2fa/disable', protect, disable2FA);
// Called after login when requires2FA === true (public — guarded by twoFaToken)
router.post('/2fa/verify',  authLimiter, verify2FA);

/**
 * 👑 ADMIN KYC ACCESS
 */
router.get('/admin/kyc-requests', protect, isAdmin, async (req, res) => {
    res.json({ message: "Secure KYC data access granted." });
});

export default router;
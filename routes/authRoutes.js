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
  verifyMe 
} from '../controllers/authController.js';

// 2. Middlewares
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js'; 

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

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC ROUTES
   ───────────────────────────────────────────────────────────────────────────── */

// 1. OTP Verification - Added authLimiter to prevent SMS/Email spam
router.post('/send-otp', authLimiter, sendOTP);
router.post('/verify-otp', authLimiter, verifyOTP);

// 2. Final Registration (Multi-part upload for KYC)
router.post('/register', upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'livenessVideo', maxCount: 1 },
    { name: 'profilePic', maxCount: 1 }
]), register);

// 3. Secure Login - Added authLimiter to prevent password guessing
router.post('/login', authLimiter, login);

// 4. Silent Token Refresh (Uses HttpOnly Cookie Rotation)
router.post('/refresh', refresh);

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
 * 👑 ADMIN KYC ACCESS
 * Double-Lock: Authentication + Role Verification
 */
router.get('/admin/kyc-requests', protect, isAdmin, async (req, res) => {
    res.json({ message: "Secure KYC data access granted." });
});

export default router;
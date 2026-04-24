import express from 'express';
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
// 🛡️ The 'protect' middleware is now the backbone of your Redis security
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js'; 

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC ROUTES
   These routes are open because they are used to GET into the system.
   ───────────────────────────────────────────────────────────────────────────── */

// 1. OTP Verification (Pre-registration checks)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// 2. Final Registration (Multi-part upload for KYC)
router.post('/register', upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'livenessVideo', maxCount: 1 },
    { name: 'profilePic', maxCount: 1 }
]), register);

// 3. Secure Login (Issues the initial JTI and Fingerprint)
router.post('/login', login);

// 4. Silent Token Refresh (Uses HttpOnly Cookie Rotation)
router.post('/refresh', refresh);

/* ─────────────────────────────────────────────────────────────────────────────
   PROTECTED ROUTES
   These require 'protect' to verify: JWT Integrity + Redis Blacklist + Fingerprint
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * 🛡️ THE TRUTH ENDPOINT: /verify-me
 * Frontend uses this to confirm the user is still 'active' in DB and not blacklisted.
 */
router.get('/verify-me', protect, verifyMe);

/**
 * 🛡️ SECURE LOGOUT
 * We ADD 'protect' here so the controller can identify the JTI and blacklist it in Redis.
 */
router.post('/logout', protect, logout);

/**
 * 👑 ADMIN KYC ACCESS
 * Double-Lock: User must be authenticated (protect) AND have the 'admin' role (isAdmin).
 */
router.get('/admin/kyc-requests', protect, isAdmin, async (req, res) => {
    // This would typically point to a controller like: getKycRequests
    res.json({ message: "Secure KYC data access granted." });
});

export default router;
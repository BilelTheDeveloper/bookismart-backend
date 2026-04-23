import express from 'express';
const router = express.Router();

// Controllers
import { 
  register, 
  login, 
  refresh, 
  sendOTP, 
  verifyOTP,
  logout,   // Added logout for completeness
  verifyMe  // This is the new Ultra-Secure endpoint we added to the controller
} from '../controllers/authController.js';

// Middlewares
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js'; 

/**
 * --- PUBLIC ROUTES ---
 * These routes do not require a token and are used for Onboarding & Auth.
 */

// 1. OTP Verification
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// 2. Final 5-Step Registration (Handles Text + Files via Multer/Cloudinary)
router.post('/register', upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'livenessVideo', maxCount: 1 },
    { name: 'profilePic', maxCount: 1 }
]), register);

// 3. Standard Secure Login
router.post('/login', login);

// 4. Silent Token Refresh (Uses HttpOnly Cookie)
router.post('/refresh', refresh);

// 5. Secure Logout
router.post('/logout', logout);

/**
 * --- PROTECTED ROUTES ---
 * These require the 'protect' middleware to verify the JWT and Fingerprint.
 */

/**
 * 🛡️ THE TRUTH ENDPOINT: /verify-me
 * Purpose: This is the ONLY route the Frontend should trust for role-checking.
 * It ignores LocalStorage and checks the signed HttpOnly cookie against the DB.
 */
router.get('/verify-me', protect, verifyMe);

// 6. Identity Verification (Admins Only)
router.get('/admin/kyc-requests', protect, isAdmin, async (req, res) => {
    res.json({ message: "Secure KYC data access granted." });
});

export default router;
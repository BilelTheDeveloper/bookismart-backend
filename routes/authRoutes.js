import express from 'express';
const router = express.Router();

// Controllers (Now including OTP functions)
import { 
  register, 
  login, 
  refresh, 
  sendOTP, 
  verifyOTP 
} from '../controllers/authController.js';

// Middlewares
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js'; 

/**
 * --- PUBLIC ROUTES ---
 * These routes do not require a token and are used for Onboarding & Auth.
 */

// 1. OTP Verification (Added to fix 404)
router.post('/send-otp', sendOTP);
router.post('/verify-otp', verifyOTP);

// 2. Final 5-Step Registration (Handles Text + Files)
// Fields: idFront (1 image), idBack (1 image), livenessVideo (1 video)
router.post('/register', upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'livenessVideo', maxCount: 1 }
]), register);

// 3. Standard Secure Login
router.post('/login', login);

// 4. Silent Token Refresh (Uses HttpOnly Cookie)
router.post('/refresh', refresh);

/**
 * --- PROTECTED ROUTES ---
 * These require the 'protect' middleware to verify the JWT and Fingerprint.
 */

// 5. Identity Verification (Admins Only)
router.get('/admin/kyc-requests', protect, isAdmin, async (req, res) => {
    res.json({ message: "Secure KYC data access granted." });
});

export default router;
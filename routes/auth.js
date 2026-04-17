import express from 'express';
// Import your custom Cloudinary utility
import uploadCloudinary from '../utils/uploadCloudinary.js';

// --- Import Step Controllers ---
import step1Profile from '../controllers/auth/step1-profile.js';
import step2Verify from '../controllers/auth/step2-verify.js';
import step3Security from '../controllers/auth/step3-security.js';
import step4KYC from '../controllers/auth/step4-kyc.js';
import step5Finalize from '../controllers/auth/step5-finalize.js';

// ✅ NEW: Import protect middleware for the session check
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * 🆔 SESSION IDENTITY CHECK
 * @route   GET /api/auth/me
 * @desc    Returns current user from the secure cookie
 * @access  Private
 */
router.get('/me', protect, (req, res) => {
  res.status(200).json({ 
    success: true, 
    user: req.user 
  });
});

/**
 * 🚪 SECURE LOGOUT
 * @route   POST /api/auth/logout
 * @desc    Clears the HttpOnly cookie
 * @access  Public
 */
router.post('/logout', (req, res) => {
  res.cookie('token', '', {
    httpOnly: true,
    expires: new Date(0), // Delete immediately
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
  });
  res.status(200).json({ success: true, message: "Logged out successfully" });
});

// --- Step 1: Profile Registration ---
router.post('/step-1', uploadCloudinary.single('profilePic'), step1Profile);

// --- Step 2: OTP Verification ---
router.post('/step-2', step2Verify);

// --- Step 3: Password Security ---
router.post('/step-3', step3Security);

// --- Step 4: Identity Verification (KYC) ---
const kycUpload = uploadCloudinary.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'livePhoto', maxCount: 1 }
]);
router.post('/step-4', kycUpload, step4KYC);

// --- Step 5: Finalize Application ---
router.post('/step-5', step5Finalize);

export default router;
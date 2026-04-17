import express from 'express';
import uploadCloudinary from '../utils/uploadCloudinary.js';

// --- Import Step Controllers ---
import step1Profile from '../controllers/auth/step1-profile.js';
import step2Verify from '../controllers/auth/step2-verify.js';
import step3Security from '../controllers/auth/step3-security.js';
import step4KYC from '../controllers/auth/step4-kyc.js';
import step5Finalize from '../controllers/auth/step5-finalize.js';

// 🛡️ Middleware
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * 🆔 SESSION IDENTITY CHECK
 * This verifies the HttpOnly cookie and returns the user data to AuthContext.
 */
router.get('/me', protect, (req, res) => {
  res.status(200).json({ 
    success: true, 
    user: req.user 
  });
});

/**
 * 🚪 SECURE LOGOUT (The Kill Switch)
 * IMPORTANT: The cookie settings here MUST match the LoginController exactly.
 */
router.post('/logout', (req, res) => {
  // Check environment for secure flag consistency
  const isProduction = process.env.NODE_ENV === 'production' || req.get('host').includes('onrender.com');

  res.cookie('token', '', {
    httpOnly: true,
    secure: true,       // 🔒 Must be true to clear a 'sameSite: none' cookie
    sameSite: 'none',   // 🌍 Must match the LoginController exactly
    expires: new Date(0), // Sets expiration to the past (Jan 1, 1970)
    path: '/',          // Ensures the cookie is cleared for the whole domain
  });

  console.log(`🧹 [Auth]: Secure logout successful at ${new Date().toISOString()}`);
  
  res.status(200).json({ 
    success: true, 
    message: "Logged out successfully. Session destroyed." 
  });
});

// --- Multi-Step Onboarding Routes ---

// Step 1: Profile Registration
router.post('/step-1', uploadCloudinary.single('profilePic'), step1Profile);

// Step 2: OTP Verification
router.post('/step-2', step2Verify);

// Step 3: Password Security
router.post('/step-3', step3Security);

// Step 4: Identity Verification (KYC)
const kycUpload = uploadCloudinary.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'livePhoto', maxCount: 1 }
]);
router.post('/step-4', kycUpload, step4KYC);

// Step 5: Finalize Application
router.post('/step-5', step5Finalize);

export default router;
import express from 'express';
// Import your custom Cloudinary utility instead of standard multer
import uploadCloudinary from '../utils/uploadCloudinary.js';

// --- Import Step Controllers ---
import step1Profile from '../controllers/auth/step1-profile.js';
import step2Verify from '../controllers/auth/step2-verify.js';
import step3Security from '../controllers/auth/step3-security.js';
import step4KYC from '../controllers/auth/step4-kyc.js';
import step5Finalize from '../controllers/auth/step5-finalize.js';

const router = express.Router();

// --- Step 1: Profile Registration ---
// Uses .single() because the owner only uploads one profile picture
router.post('/step-1', uploadCloudinary.single('profilePic'), step1Profile);

// --- Step 2: OTP Verification ---
// No file upload needed here
router.post('/step-2', step2Verify);

// --- Step 3: Password Security ---
// No file upload needed here
router.post('/step-3', step3Security);

// --- Step 4: Identity Verification (KYC) ---
// Uses .fields() to handle multiple specific identity documents
const kycUpload = uploadCloudinary.fields([
  { name: 'idFront', maxCount: 1 },
  { name: 'idBack', maxCount: 1 },
  { name: 'livePhoto', maxCount: 1 }
]);
router.post('/step-4', kycUpload, step4KYC);

// --- Step 5: Finalize Application ---
// No file upload needed here
router.post('/step-5', step5Finalize);

export default router;
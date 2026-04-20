import express from 'express';
const router = express.Router();

// Controllers
import { register, login, refresh } from '../controllers/authController.js';

// Middlewares (Rule 3)
import { protect, isAdmin } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js'; // To be created for Multer/Cloudinary

/**
 * --- PUBLIC ROUTES ---
 */

// 1. Final 5-Step Registration (Handles Text + Files)
// We expect: idFront (1 image), idBack (1 image), livenessVideo (1 video)
router.post('/register', upload.fields([
    { name: 'idFront', maxCount: 1 },
    { name: 'idBack', maxCount: 1 },
    { name: 'livenessVideo', maxCount: 1 }
]), register);

// 2. Standard Secure Login
router.post('/login', login);

// 3. Silent Token Refresh (Uses HttpOnly Cookie)
router.post('/refresh', refresh);

/**
 * --- PROTECTED ROUTES ---
 */

// 4. Identity Verification (Admins Only - Step 4 Review)
// This is the API route for your "See Dossier" frontend page
router.get('/admin/kyc-requests', protect, isAdmin, async (req, res) => {
    // This logic usually goes in a separate kycController, 
    // but we can place a placeholder here for now.
    res.json({ message: "Secure KYC data access granted." });
});

export default router;
import express from 'express';
import { 
  saveWebsite, 
  getMyWebsite,
  uploadWebsiteImage // 🆕 Added for Cloudinary
} from '../controllers/websiteController.js';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js'; // 🆕 Your Multer-Cloudinary config

const router = express.Router();

/**
 * 🌐 WEBSITE MANAGEMENT ROUTES
 * All routes are prefixed with: /api/merchant/website
 */

// --- 1. GET MERCHANT CONFIGURATION ---
// Purpose: Fetch the current website data to populate the frontend form.
// Security: [PROTECT] ensures only the logged-in owner sees their own data.
router.get('/my-site', protect, getMyWebsite);

// --- 2. SAVE/UPDATE CONFIGURATION ---
// Purpose: Save the website builder progress or publish changes.
// Security: [PROTECT] ensures the ID used to save is taken from the Secure Cookie.
router.post('/save', protect, saveWebsite);

// --- 3. IMAGE UPLOAD TO CLOUDINARY ---
// Purpose: Securely upload an image and get a permanent URL back.
// Security: [PROTECT] ensures only merchants can upload.
// Logic: 'upload.single' uses the key 'image' from the frontend FormData.
router.post('/upload', protect, upload.single('image'), uploadWebsiteImage);

export default router;
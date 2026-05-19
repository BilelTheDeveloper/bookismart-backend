import express from 'express';
import { 
  saveWebsite, 
  getMyWebsite,
  uploadWebsiteImage // 🆕 Added for Cloudinary
} from '../controllers/websiteController.js';
import { protect } from '../middleware/authMiddleware.js';
import upload, { uploadGallery } from '../config/cloudinary.js';

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

// --- 3. SINGLE IMAGE UPLOAD (hero, about, generic asset) ---
// Field name from FormData can be: 'image' | 'heroImage' | 'aboutImage'
router.post('/upload', protect, upload.single('image'),     uploadWebsiteImage);
router.post('/upload/hero',  protect, upload.single('heroImage'),  uploadWebsiteImage);
router.post('/upload/about', protect, upload.single('aboutImage'), uploadWebsiteImage);

// --- 4. GALLERY BULK UPLOAD (up to 10 images) ---
// FormData field: 'galleryImage' (array)
router.post('/upload/gallery', protect, uploadGallery.array('galleryImage', 10), uploadWebsiteImage);

export default router;
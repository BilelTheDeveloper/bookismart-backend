import express from 'express';
import {
  saveWebsite,
  saveBuilder,
  getMyWebsite,
  uploadWebsiteImage,
  uploadPresentationReel,
  deletePresentationReel,
} from '../controllers/websiteController.js';
import { protect } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/planMiddleware.js';
import { FEATURES } from '../config/plans.js';
import upload, { uploadGallery, uploadReel } from '../config/cloudinary.js';
import { privateCache, TTL } from '../middleware/cache.js';

const router = express.Router();

/**
 * 🌐 WEBSITE MANAGEMENT ROUTES
 * All routes are prefixed with: /api/merchant/website
 */

// --- 1. GET MERCHANT CONFIGURATION ---
// Purpose: Fetch the current website data to populate the frontend form.
// Security: [PROTECT] ensures only the logged-in owner sees their own data.
router.get('/my-site',
  protect,
  privateCache(() => ['my-site'], TTL.MY_WEBSITE),
  getMyWebsite,
);

// --- 2. SAVE/UPDATE CONFIGURATION ---
// Purpose: Save the website builder progress or publish changes.
// Security: [PROTECT] ensures the ID used to save is taken from the Secure Cookie.
router.post('/save', protect, saveWebsite);

// --- 2b. SAVE SECTION BUILDER (dynamic Shopify-style site) ---
// The Shopify-style builder is a paid feature (Solo Pro / Team+). The fixed
// category templates above (/save) remain available on every plan. Trial = full access.
router.post('/builder', protect, requireFeature(FEATURES.WEBSITE_BUILDER), saveBuilder);

// --- 3. SINGLE IMAGE UPLOAD (hero, about, generic asset) ---
// Field name from FormData can be: 'image' | 'heroImage' | 'aboutImage'
router.post('/upload', protect, upload.single('image'),     uploadWebsiteImage);
router.post('/upload/hero',  protect, upload.single('heroImage'),  uploadWebsiteImage);
router.post('/upload/about', protect, upload.single('aboutImage'), uploadWebsiteImage);

// --- 4. GALLERY BULK UPLOAD (up to 10 images) ---
// FormData field: 'galleryImage' (array)
router.post('/upload/gallery', protect, uploadGallery.array('galleryImage', 10), uploadWebsiteImage);

// --- 5. PRESENTATION REEL UPLOAD (single video, max 30s enforced in controller) ---
router.post('/upload/reel',   protect, uploadReel.single('presentationReel'), uploadPresentationReel);
router.delete('/upload/reel', protect, deletePresentationReel);

// --- 6. BEFORE / AFTER IMAGE UPLOAD ---
router.post('/upload/beforeafter', protect, upload.single('beforeAfterImage'), uploadWebsiteImage);

export default router;
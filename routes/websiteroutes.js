import express from 'express';
import { 
  saveWebsite, 
  getMyWebsite 
} from '../controllers/websitecontroller.js';
import { protect } from '../middleware/authmiddleware.js';

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

export default router;
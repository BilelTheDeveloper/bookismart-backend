import express from 'express';
import { 
  getPendingWebsites, 
  updateWebsiteStatus,
  getApprovedWebsites 
} from '../../controllers/admin/webVerificationController.js';

import { protect, admin } from '../../middleware/authMiddleware.js';

const router = express.Router();

// --- 🔒 ADMIN ONLY ROUTES ---

router.get('/pending', protect, admin, getPendingWebsites);
router.patch('/status/:id', protect, admin, updateWebsiteStatus);

// --- 🌍 PUBLIC ROUTE ---

/**
 * @route   GET /api/admin/websites/approved
 * @desc    Fetch live websites for the public marketplace
 * @access  Public (Removed protect and admin)
 */
router.get('/approved', getApprovedWebsites); // ✅ Fixed: Removed middleware

export default router;
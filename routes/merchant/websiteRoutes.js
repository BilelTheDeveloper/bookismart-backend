import express from 'express';
import { 
  saveWebsiteData, 
  getMyWebsite 
} from '../../controllers/merchant/websiteController.js';

// Import your existing auth middleware
// 'protect' ensures the user is logged in
// 'isOwner' ensures the user has the 'owner' role from your User model
import { protect, isOwner } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/merchant/website/my-site
 * @desc    Retrieve the current merchant's website configuration
 * @access  Private (Owner Only)
 */
router.get('/my-site', protect, isOwner, getMyWebsite);

/**
 * @route   POST /api/merchant/website/save
 * @desc    Create or update the website (Triggers 'pending' verification)
 * @access  Private (Owner Only)
 */
router.post('/save', protect, isOwner, saveWebsiteData);

export default router;
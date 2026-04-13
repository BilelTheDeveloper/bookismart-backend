import express from 'express';
import { 
  getPendingWebsites, 
  updateWebsiteStatus,
  getApprovedWebsites // ✅ Added this import
} from '../../controllers/admin/webVerificationController.js';

// Import your existing auth middleware
import { protect, admin } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/admin/websites/pending
 * @desc    Fetch all websites waiting for deployment approval
 * @access  Private (Admin Only)
 * * NOTE: Since this is mounted at '/api/admin/websites' in server.js,
 * we only use '/pending' here.
 */
router.get('/pending', protect, admin, getPendingWebsites);

/**
 * @route   GET /api/admin/websites/approved
 * @desc    Fetch all websites that are live (for the Professionals page)
 * @access  Private (Admin Only)
 */
router.get('/approved', protect, admin, getApprovedWebsites);

/**
 * @route   PATCH /api/admin/websites/status/:id
 * @desc    Approve or Reject a website deployment
 * @access  Private (Admin Only)
 */
router.patch('/status/:id', protect, admin, updateWebsiteStatus);

export default router;
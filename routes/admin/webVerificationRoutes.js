import express from 'express';
import { 
  getPendingWebsites, 
  updateWebsiteStatus,
  getApprovedWebsites 
} from '../../controllers/admin/webVerificationController.js';

// ✅ This imports the updated middleware that looks for req.cookies.token
import { protect, admin } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/admin/websites/approved
 * @desc    Fetch all websites that are live (Public Marketplace)
 * @access  Public ✅ 
 */
router.get('/approved', getApprovedWebsites); 

/**
 * @route   GET /api/admin/websites/pending
 * @desc    Fetch all websites waiting for deployment approval
 * @access  Private (Admin Only) 🛡️
 * @note    This route now automatically checks for the HttpOnly cookie.
 */
router.get('/pending', protect, admin, getPendingWebsites);

/**
 * @route   PATCH /api/admin/websites/status/:id
 * @desc    Approve or Reject a website deployment
 * @access  Private (Admin Only) 🛡️
 */
router.patch('/status/:id', protect, admin, updateWebsiteStatus);

export default router;
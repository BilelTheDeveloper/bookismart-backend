import express from 'express';
import { 
  getPendingVerifications, 
  updateVerificationStatus 
} from '../../controllers/admin/userVerificationController.js';

const router = express.Router();

/**
 * @route   GET /api/admin/user-verification/pending
 * @desc    Get all merchants with pending KYC status
 * @access  Private (Admin Only)
 */
router.get('/pending', getPendingVerifications);

/**
 * @route   PATCH /api/admin/user-verification/verify/:id
 * @desc    Approve or Reject a merchant's KYC documents
 * @access  Private (Admin Only)
 */
router.patch('/verify/:id', updateVerificationStatus);

export default router;
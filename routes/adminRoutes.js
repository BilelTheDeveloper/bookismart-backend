import express from 'express';
const router = express.Router();

// Controllers
import { 
  reviewUserIdentity, 
  getPendingVerifications 
} from '../controllers/userVerificationController.js';

// Middlewares
import { protect } from '../middleware/authMiddleware.js';
import { adminGuard } from '../middleware/adminGuard.js';

/**
 * 🔒 ALL ROUTES HERE ARE HARD-PROTECTED
 * 1. Must have a valid JWT & Device Fingerprint (handled by 'protect')
 * 2. Must pass Real-Time DB Verification, Status Check, and Role Clearance (handled by 'adminGuard')
 * * NOTE: 'adminGuard' replaces 'isAdmin' for superior security and real-time revoking.
 */

// Global middleware application for this router
// This ensures any new route added below is automatically secured
router.use(protect);
router.use(adminGuard);

/**
 * --- ADMIN ACTION MODULE ---
 */

// @desc    Fetch all users waiting for KYC approval
// @route   GET /api/admin/verifications/pending
router.get('/verifications/pending', getPendingVerifications);

// @desc    Approve or Reject a user's identity documents
// @route   PATCH /api/admin/verifications/review/:id
router.patch('/verifications/review/:id', reviewUserIdentity);

export default router;
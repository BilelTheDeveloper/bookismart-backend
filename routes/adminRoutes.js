import express from 'express';
const router = express.Router();

import { 
  reviewUserIdentity, 
  getPendingVerifications 
} from '../controllers/userVerificationController.js';

import { protect, isAdmin } from '../middleware/authMiddleware.js';

/**
 * ALL ROUTES HERE ARE HARD-PROTECTED
 * 1. Must have a valid JWT & Device Fingerprint (protect)
 * 2. Must have 'admin' role in the DB (isAdmin)
 */

// GET /api/admin/verifications/pending
router.get('/verifications/pending', protect, isAdmin, getPendingVerifications);

// PATCH /api/admin/verifications/review/:id
router.patch('/verifications/review/:id', protect, isAdmin, reviewUserIdentity);

export default router;
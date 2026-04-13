import express from 'express';
import { 
  getPendingWebsites, 
  updateWebsiteStatus 
} from '../../controllers/admin/webVerificationController.js';

import { protect, admin } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * UPDATED ROUTE: Matches what frontend is calling
 * @route   GET /api/admin/websites/pending
 */
router.get('/websites/pending', protect, admin, getPendingWebsites);

/**
 * UPDATED ROUTE: Matches the common pattern for status updates
 * @route   PATCH /api/admin/websites/status/:id
 */
router.patch('/websites/status/:id', protect, admin, updateWebsiteStatus);

export default router;
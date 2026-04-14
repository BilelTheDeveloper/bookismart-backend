import express from 'express';
import { getWebsiteBySlug } from '../controllers/admin/webVerificationController.js';

const router = express.Router();

/**
 * @route   GET /api/public/website/:slug
 * @desc    Get website data by slug for public profile view
 * @access  Public (No Auth Needed)
 */
router.get('/website/:slug', getWebsiteBySlug);

export default router;
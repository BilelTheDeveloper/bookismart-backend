import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/planMiddleware.js';
import { FEATURES } from '../config/plans.js';
import { getAudience, getCampaigns, sendBroadcast } from '../controllers/marketingController.js';

const router = express.Router();

// Marketing campaigns are a paid feature (Solo Pro / Business+). Trial = full access.
router.use(protect, requireFeature(FEATURES.MARKETING));

router.get('/audience',   getAudience);
router.get('/campaigns',  getCampaigns);
router.post('/broadcast', sendBroadcast);

export default router;

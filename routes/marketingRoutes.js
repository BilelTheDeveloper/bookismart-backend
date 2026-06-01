import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getAudience, getCampaigns, sendBroadcast } from '../controllers/marketingController.js';

const router = express.Router();

router.get('/audience',   protect, getAudience);
router.get('/campaigns',  protect, getCampaigns);
router.post('/broadcast', protect, sendBroadcast);

export default router;

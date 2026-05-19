import express from 'express';
const router = express.Router();
import { getDiscoveryFeed, getDiscoveryStats, getWebsiteBySlug } from '../controllers/publicController.js';
import { validateDiscountCode } from '../controllers/loyaltyController.js';

// No protection middleware here -> These are 100% Public
router.get('/discovery',       getDiscoveryFeed);
router.get('/discovery/stats', getDiscoveryStats);
router.get('/site/:slug',      getWebsiteBySlug);
router.post('/loyalty/validate-code', validateDiscountCode);

export default router;
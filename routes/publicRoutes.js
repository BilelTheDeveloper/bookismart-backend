import express from 'express';
const router = express.Router();
import { getDiscoveryFeed, getWebsiteBySlug } from '../controllers/publicController.js';

// No protection middleware here -> These are 100% Public
router.get('/discovery', getDiscoveryFeed);
router.get('/site/:slug', getWebsiteBySlug);

export default router;
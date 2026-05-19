import express from 'express';
const router = express.Router();
import {
  getDiscoveryFeed,
  getDiscoveryStats,
  getWebsiteBySlug,
  getPublicReviews,
  reviewLookup,
  submitPublicReview,
  getDisplayQueue,
} from '../controllers/publicController.js';
import { validateDiscountCode } from '../controllers/loyaltyController.js';
import rateLimit from 'express-rate-limit';

const reviewSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many review submissions. Try again later.' },
});

// No protection middleware — fully public
router.get('/discovery',         getDiscoveryFeed);
router.get('/discovery/stats',   getDiscoveryStats);
router.get('/site/:slug',        getWebsiteBySlug);
router.post('/loyalty/validate-code', validateDiscountCode);

// Review system
router.get('/reviews/lookup',      reviewLookup);
router.get('/reviews/:ownerId',    getPublicReviews);
router.post('/reviews/submit',     reviewSubmitLimiter, submitPublicReview);

// Waiting room display (public, no auth — returns only first names)
router.get('/display/:slug',       getDisplayQueue);

export default router;

import express from 'express';
import mongoose from 'mongoose';
import rateLimit from 'express-rate-limit';
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

const router = express.Router();

const reviewSubmitLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  message: { success: false, message: 'Too many review submissions. Try again later.' },
});

const reviewLookupLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: { success: false, message: 'Too many lookup attempts. Try again later.' },
});

const validateObjectId = (paramName) => (req, res, next) => {
  const id = req.params[paramName];
  if (!mongoose.Types.ObjectId.isValid(id)) {
    return res.status(400).json({ success: false, message: 'Invalid identifier.' });
  }
  next();
};

// No protection middleware — fully public
router.get('/discovery',              getDiscoveryFeed);
router.get('/discovery/stats',        getDiscoveryStats);
router.get('/site/:slug',             getWebsiteBySlug);
router.post('/loyalty/validate-code', validateDiscountCode);

// Review system
router.get('/reviews/lookup',                                  reviewLookupLimiter, reviewLookup);
router.get('/reviews/:ownerId',       validateObjectId('ownerId'), getPublicReviews);
router.post('/reviews/submit',        reviewSubmitLimiter,        submitPublicReview);

// Waiting room display (public, no auth — returns only first names)
router.get('/display/:slug',          getDisplayQueue);

export default router;

import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { requireFeature } from '../middleware/planMiddleware.js';
import { FEATURES } from '../config/plans.js';
import {
  getOffers, createOffer, updateOffer, deleteOffer,
  getIssued, issueOffer, redeemIssued, cancelIssued, getPackageStats,
} from '../controllers/packageController.js';

const router = express.Router();

// Packages, memberships & gift cards are a paid feature (Solo Pro / Business+). Trial = full access.
router.use(protect, requireFeature(FEATURES.PACKAGES));

router.get('/stats',  getPackageStats);

router.get('/offers',      getOffers);
router.post('/offers',     createOffer);
router.put('/offers/:id',  updateOffer);
router.delete('/offers/:id', deleteOffer);

router.get('/issued',            getIssued);
router.post('/issue',            issueOffer);
router.post('/issued/:id/redeem', redeemIssued);
router.delete('/issued/:id',     cancelIssued);

export default router;

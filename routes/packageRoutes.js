import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getOffers, createOffer, updateOffer, deleteOffer,
  getIssued, issueOffer, redeemIssued, cancelIssued, getPackageStats,
} from '../controllers/packageController.js';

const router = express.Router();

router.get('/stats',  protect, getPackageStats);

router.get('/offers',      protect, getOffers);
router.post('/offers',     protect, createOffer);
router.put('/offers/:id',  protect, updateOffer);
router.delete('/offers/:id', protect, deleteOffer);

router.get('/issued',            protect, getIssued);
router.post('/issue',            protect, issueOffer);
router.post('/issued/:id/redeem', protect, redeemIssued);
router.delete('/issued/:id',     protect, cancelIssued);

export default router;

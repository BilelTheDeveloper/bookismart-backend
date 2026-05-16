import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  getOwnerInsightsSummary,
  getOwnerCustomers,
  getOwnerCustomerHistory,
  getAnalyticsData,
} from '../controllers/merchantInsightsController.js';

const router = express.Router();
router.use(protect, requireRole('owner'));

router.get('/summary', getOwnerInsightsSummary);
router.get('/analytics', getAnalyticsData);
router.get('/customers', getOwnerCustomers);
router.get('/customers/:customerKey/history', getOwnerCustomerHistory);

export default router;


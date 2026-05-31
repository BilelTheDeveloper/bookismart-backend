import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  getOwnerInsightsSummary,
  getOwnerCustomers,
  getOwnerCustomerHistory,
  getAnalyticsData,
} from '../controllers/merchantInsightsController.js';
import { privateCache, TTL } from '../middleware/cache.js';

const router = express.Router();
router.use(protect, requireRole('owner'));

router.get('/summary',
  privateCache(() => ['kpi'], TTL.KPI),
  getOwnerInsightsSummary,
);

router.get('/analytics',
  privateCache(() => ['analytics'], TTL.ANALYTICS),
  getAnalyticsData,
);

router.get('/customers',
  privateCache(() => ['customers'], TTL.CUSTOMER_LIST),
  getOwnerCustomers,
);

// Customer history is user-scoped but also keyed by customerKey (email or phone)
router.get('/customers/:customerKey/history',
  privateCache(req => ['cust-hist', req.params.customerKey], TTL.CUSTOMER_LIST),
  getOwnerCustomerHistory,
);

export default router;


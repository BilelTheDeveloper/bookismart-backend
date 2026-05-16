import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  getProgram,
  updateProgram,
  addDiscountCode,
  toggleDiscountCode,
  deleteDiscountCode,
  getCustomerLoyalty,
  awardLoyalty,
  redeemLoyalty,
} from '../controllers/loyaltyController.js';
import { validateDiscountCode } from '../controllers/loyaltyController.js';

const router = express.Router();

// Public route — validate discount code at booking time (no auth)
router.post('/validate-code', validateDiscountCode);

// Owner-protected routes
router.use(protect, requireRole('owner'));
router.get('/program', getProgram);
router.put('/program', updateProgram);
router.post('/program/codes', addDiscountCode);
router.patch('/program/codes/:codeId/toggle', toggleDiscountCode);
router.delete('/program/codes/:codeId', deleteDiscountCode);
router.get('/customers', getCustomerLoyalty);
router.post('/award', awardLoyalty);
router.post('/redeem', redeemLoyalty);

export default router;

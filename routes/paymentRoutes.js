import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getPlans, getPaymentStatus, saveDepositPolicy, listPayments,
  createCheckoutSession, createPortalSession, handleWebhook,
} from '../controllers/paymentController.js';

const router = express.Router();

// Provider webhook — public, raw body (mounted before express.json + auth)
router.post('/webhook', express.raw({ type: '*/*' }), handleWebhook);
router.get('/webhook',  handleWebhook); // some providers ping via GET return

router.use(protect);
router.get('/plans',            getPlans);
router.get('/status',           getPaymentStatus);
router.put('/deposit-policy',   saveDepositPolicy);
router.get('/list',             listPayments);
router.post('/checkout',        createCheckoutSession);
router.post('/portal',          createPortalSession);

export default router;

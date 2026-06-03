import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getPlans, getEntitlements, getPaymentStatus, saveDepositPolicy, listPayments,
  createCheckoutSession, createPortalSession, handleWebhook,
} from '../controllers/paymentController.js';

/**
 * Provider webhook — PUBLIC + raw body. Mounted in server.js BEFORE express.json
 * so the raw body survives. Kept on its own router so the rest of the payment
 * routes can sit AFTER the full security stack (cookies, CSRF, rate-limit).
 */
export const webhookRouter = express.Router();
webhookRouter.post('/webhook', express.raw({ type: '*/*' }), handleWebhook);
webhookRouter.get('/webhook',  handleWebhook); // some providers ping via GET return

/**
 * Authenticated payment routes — mounted in server.js AFTER cookieParser,
 * express.json, fingerprint, CSRF, and the global rate limiter.
 */
const router = express.Router();
router.use(protect);
router.get('/plans',            getPlans);
router.get('/entitlements',     getEntitlements);
router.get('/status',           getPaymentStatus);
router.put('/deposit-policy',   saveDepositPolicy);
router.get('/list',             listPayments);
router.post('/checkout',        createCheckoutSession);
router.post('/portal',          createPortalSession);

export default router;

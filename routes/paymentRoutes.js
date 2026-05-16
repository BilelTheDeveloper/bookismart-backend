import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getPlans, createCheckoutSession, createPortalSession, handleWebhook } from '../controllers/paymentController.js';

const router = express.Router();

// Stripe webhook must receive raw body — mounted BEFORE express.json()
router.post('/webhook', express.raw({ type: 'application/json' }), handleWebhook);

router.use(protect);
router.get('/plans',          getPlans);
router.post('/checkout',      createCheckoutSession);
router.post('/portal',        createPortalSession);

export default router;

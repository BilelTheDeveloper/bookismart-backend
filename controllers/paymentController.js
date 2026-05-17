/**
 * Payment Controller — Flouci (Tunisia)
 * Stripe removed: not available in Tunisia.
 * Flouci integration will be implemented here.
 * Env vars needed: FLOUCI_APP_TOKEN, FLOUCI_APP_SECRET
 */
import User from '../models/User.js';

const PLANS = {
  basic:   { name: 'Basic',   price: 29  },
  premium: { name: 'Premium', price: 79  },
  pro:     { name: 'Pro',     price: 149 },
};

export const getPlans = (req, res) => {
  res.json({
    success: true,
    plans: Object.entries(PLANS).map(([key, val]) => ({ key, ...val })),
  });
};

export const createCheckoutSession = async (req, res) => {
  res.status(503).json({ success: false, message: 'Payment system coming soon.' });
};

export const createPortalSession = async (req, res) => {
  res.status(503).json({ success: false, message: 'Payment system coming soon.' });
};

export const handleWebhook = async (req, res) => {
  res.json({ received: true });
};

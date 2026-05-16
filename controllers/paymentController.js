/**
 * Stripe Payment Controller
 * Requires: npm install stripe  (in server/)
 * Env vars: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET,
 *           STRIPE_PRICE_BASIC, STRIPE_PRICE_PREMIUM, STRIPE_PRICE_PRO
 */
import Stripe from 'stripe';
import User from '../models/User.js';
import { notifyUser } from '../utils/notifyUser.js';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || 'sk_test_placeholder', {
  apiVersion: '2024-04-10',
});

const PLANS = {
  basic:   { name: 'Basic',   price: 29,  priceId: process.env.STRIPE_PRICE_BASIC   },
  premium: { name: 'Premium', price: 79,  priceId: process.env.STRIPE_PRICE_PREMIUM },
  pro:     { name: 'Pro',     price: 149, priceId: process.env.STRIPE_PRICE_PRO     },
};

/* ── Get available plans ── */
export const getPlans = (req, res) => {
  res.json({
    success: true,
    plans: Object.entries(PLANS).map(([key, val]) => ({ key, ...val })),
  });
};

/* ── Create Stripe Checkout Session ── */
export const createCheckoutSession = async (req, res) => {
  try {
    const { planKey } = req.body;
    const plan = PLANS[planKey];
    if (!plan) return res.status(400).json({ success: false, message: 'Invalid plan.' });
    if (!plan.priceId) return res.status(503).json({ success: false, message: 'Stripe price not configured for this plan.' });

    const user = await User.findById(req.user._id).select('email fullName stripeCustomerId').lean();
    let customerId = user.stripeCustomerId;

    // Create Stripe customer if not exists
    if (!customerId) {
      const customer = await stripe.customers.create({ email: user.email, name: user.fullName, metadata: { userId: user._id.toString() } });
      customerId = customer.id;
      await User.findByIdAndUpdate(req.user._id, { stripeCustomerId: customerId });
    }

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      line_items: [{ price: plan.priceId, quantity: 1 }],
      success_url: `${process.env.CLIENT_URL}/owner/dashboard/billing?success=1&plan=${planKey}`,
      cancel_url:  `${process.env.CLIENT_URL}/owner/dashboard/billing?cancelled=1`,
      metadata: { userId: req.user._id.toString(), planKey },
      allow_promotion_codes: true,
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Open Stripe Customer Portal (manage billing) ── */
export const createPortalSession = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('stripeCustomerId').lean();
    if (!user.stripeCustomerId) {
      return res.status(400).json({ success: false, message: 'No billing account found. Please subscribe first.' });
    }

    const session = await stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: `${process.env.CLIENT_URL}/owner/dashboard/billing`,
    });

    res.json({ success: true, url: session.url });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ── Stripe Webhook handler ── */
export const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).json({ message: `Webhook Error: ${err.message}` });
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const userId  = session.metadata?.userId;
        const planKey = session.metadata?.planKey;
        if (userId && planKey) {
          await User.findByIdAndUpdate(userId, {
            'subscription.plan':   planKey,
            'subscription.status': 'active',
            stripeSubscriptionId:  session.subscription,
          });
          notifyUser(null, userId, {
            type: 'payment', title: `Subscription activated — ${PLANS[planKey]?.name || planKey} plan`,
            body: 'Your subscription is now active. Enjoy all features!',
            link: '/owner/dashboard/billing',
          });
        }
        break;
      }

      case 'customer.subscription.updated': {
        const sub    = event.data.object;
        const userId = (await stripe.customers.retrieve(sub.customer))?.metadata?.userId;
        if (userId) {
          await User.findByIdAndUpdate(userId, { 'subscription.status': sub.status });
        }
        break;
      }

      case 'customer.subscription.deleted': {
        const sub    = event.data.object;
        const userId = (await stripe.customers.retrieve(sub.customer))?.metadata?.userId;
        if (userId) {
          await User.findByIdAndUpdate(userId, {
            'subscription.plan':   'free_trial',
            'subscription.status': 'cancelled',
            stripeSubscriptionId:  null,
          });
          notifyUser(null, userId, {
            type: 'payment', title: 'Subscription cancelled',
            body: 'Your subscription has been cancelled. Your access will end at the billing period.',
            link: '/owner/dashboard/billing',
          });
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const userId  = (await stripe.customers.retrieve(invoice.customer))?.metadata?.userId;
        if (userId) {
          notifyUser(null, userId, {
            type: 'payment', title: 'Payment failed',
            body: 'We could not process your latest payment. Please update your payment method.',
            link: '/owner/dashboard/billing',
          });
        }
        break;
      }
    }
  } catch {
    // Non-blocking
  }

  res.json({ received: true });
};

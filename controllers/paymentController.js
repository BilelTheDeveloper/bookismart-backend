/**
 * Payment Controller — Tunisia (Flouci / Konnect).
 * All provider credentials are read from env (see utils/paymentProviders.js).
 */
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import Booking from '../models/Booking.js';
import { providerStatus, createPaymentLink, verifyPayment } from '../utils/paymentProviders.js';
import {
  PLANS, getPlan, plansForAudience, serializePlan,
  resolveEntitlements, serializeEntitlements, CURRENCY,
} from '../config/plans.js';

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

// GET /api/payments/plans — full catalog (optionally ?audience=individual|organization)
export const getPlans = (req, res) => {
  const { audience } = req.query;
  const list = audience ? plansForAudience(audience) : Object.values(PLANS);
  res.json({ success: true, currency: CURRENCY, plans: list.map(serializePlan) });
};

// GET /api/payments/entitlements — what the current owner's plan unlocks (trial-aware)
export const getEntitlements = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('accountType organization paymentInfo');
    res.json({ success: true, entitlements: serializeEntitlements(resolveEntitlements(user || {})) });
  } catch (err) {
    console.error('[ENTITLEMENTS]', err.message);
    res.status(500).json({ success: false, message: 'Could not load your plan.' });
  }
};

// GET /api/payments/status — which providers are configured (env) + owner deposit policy
export const getPaymentStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('bookingPolicy');
    res.json({
      success: true,
      providers: providerStatus(),
      policy: user?.bookingPolicy || { depositEnabled: false, depositType: 'fixed', depositValue: 0, provider: 'flouci' },
    });
  } catch { res.status(500).json({ success: false, message: 'Status unavailable.' }); }
};

// PUT /api/payments/deposit-policy
export const saveDepositPolicy = async (req, res) => {
  try {
    const { depositEnabled, depositType, depositValue, provider } = req.body;
    const policy = {
      depositEnabled: !!depositEnabled,
      depositType: depositType === 'percent' ? 'percent' : 'fixed',
      depositValue: Math.max(0, num(depositValue)),
      provider: provider === 'konnect' ? 'konnect' : 'flouci',
    };
    await User.findByIdAndUpdate(req.user._id, { $set: { bookingPolicy: policy } });
    res.json({ success: true, policy });
  } catch { res.status(500).json({ success: false, message: 'Could not save policy.' }); }
};

// GET /api/payments/list — owner's payment history
export const listPayments = async (req, res) => {
  try {
    const payments = await Payment.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).limit(100);
    const paidAgg = await Payment.aggregate([
      { $match: { ownerId: req.user._id, status: 'paid' } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]);
    res.json({ success: true, payments, totalPaid: paidAgg[0]?.total || 0, paidCount: paidAgg[0]?.count || 0 });
  } catch { res.status(500).json({ success: false, message: 'Could not load payments.' }); }
};

/**
 * Internal helper: create a deposit payment + provider link for a booking.
 * Returns { payUrl } or null. Used by the booking flow.
 */
export const createDepositForBooking = async ({ owner, booking }) => {
  const policy = owner?.bookingPolicy;
  if (!policy?.depositEnabled) return null;
  const st = providerStatus();
  if (!st.enabled) return null;

  const servicePrice = num(String(booking.service?.price || '').replace(/[^0-9.]/g, ''));
  const amount = policy.depositType === 'percent'
    ? Math.round(servicePrice * (policy.depositValue / 100) * 1000) / 1000
    : policy.depositValue;
  if (!amount || amount <= 0) return null;

  const payment = await Payment.create({
    ownerId: owner._id,
    bookingId: booking._id,
    kind: 'deposit',
    amount,
    provider: policy.provider,
    status: 'pending',
    customerName: booking.customerName,
    customerEmail: booking.customerEmail,
    customerPhone: booking.customerPhone,
  });

  const appUrl = process.env.PUBLIC_APP_URL || 'https://bookiify.vercel.app';
  const apiUrl = process.env.PUBLIC_API_URL || '';
  const link = await createPaymentLink({
    provider: policy.provider,
    amount,
    ref: String(payment._id),
    successUrl: `${appUrl}/book/${owner._id}?paid=1`,
    failUrl: `${appUrl}/book/${owner._id}?paid=0`,
    webhookUrl: apiUrl ? `${apiUrl}/payments/webhook` : undefined,
    customer: { name: booking.customerName, email: booking.customerEmail, phone: booking.customerPhone },
  });

  if (!link.ok) { payment.status = 'failed'; payment.meta = { error: link.error }; await payment.save(); return null; }
  payment.providerRef = link.providerRef || '';
  payment.payUrl = link.payUrl;
  payment.provider = link.provider;
  await payment.save();
  return { payUrl: link.payUrl, paymentId: payment._id, amount };
};

// POST /api/payments/webhook — provider callback (also works as a verify-and-reconcile)
export const handleWebhook = async (req, res) => {
  try {
    // Konnect sends ?payment_ref=...; Flouci redirects with payment_id. Accept either + body.
    let body = req.body;
    if (Buffer.isBuffer(body)) { try { body = JSON.parse(body.toString() || '{}'); } catch { body = {}; } }
    const ref = req.query.payment_ref || req.query.payment_id || body?.paymentRef || body?.payment_id || body?.id;
    if (!ref) return res.json({ received: true });

    const payment = await Payment.findOne({ $or: [{ providerRef: ref }, { _id: ref }] });
    if (!payment || payment.status === 'paid') return res.json({ received: true });

    const v = await verifyPayment({ provider: payment.provider, providerRef: payment.providerRef || ref });
    if (v.paid) {
      payment.status = 'paid';
      payment.paidAt = new Date();
      await payment.save();
      if (payment.bookingId) {
        await Booking.findByIdAndUpdate(payment.bookingId, { $set: { depositPaid: true, status: 'confirmed' } }).catch(() => {});
      }
    }
    res.json({ received: true, paid: v.paid });
  } catch (e) {
    console.error('[PAYMENT_WEBHOOK]', e.message);
    res.json({ received: true });
  }
};

// POST /api/payments/checkout — start a subscription checkout for { plan }
// (graceful stub until recurring subscription billing is wired to the providers)
export const createCheckoutSession = async (req, res) => {
  const plan = getPlan(req.body?.plan);
  if (!plan) return res.status(400).json({ success: false, message: 'Unknown plan.' });
  if (plan.custom) {
    return res.json({ success: true, contactSales: true, message: 'Enterprise plans are tailored to you — our team will reach out.' });
  }
  if (providerStatus().enabled) {
    return res.json({
      success: true,
      message: 'Subscription checkout uses the same providers — coming online.',
      plan: serializePlan(plan),
      checkoutUrl: null,
    });
  }
  res.status(503).json({ success: false, message: 'Payment system not configured yet.' });
};
export const createPortalSession = async (req, res) => {
  res.status(503).json({ success: false, message: 'Billing portal coming soon.' });
};

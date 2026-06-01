import Package from '../models/Package.js';
import CustomerPackage from '../models/CustomerPackage.js';

const KINDS = ['package', 'membership', 'giftcard'];
const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const genCode = () => {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  return 'GC-' + Array.from({ length: 8 }, () => a[Math.floor(Math.random() * a.length)]).join('');
};

/* ── OFFERS (sellable) ───────────────────────────────────────────────────── */

export const getOffers = async (req, res) => {
  try {
    const offers = await Package.find({ ownerId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, offers });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not load offers.' }); }
};

export const createOffer = async (req, res) => {
  try {
    const { kind, name, description, price, sessions, durationDays, value, serviceTitle, color } = req.body;
    if (!KINDS.includes(kind)) return res.status(400).json({ success: false, message: 'Invalid offer type.' });
    if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required.' });

    const offer = await Package.create({
      ownerId: req.user._id,
      kind,
      name: name.trim(),
      description: (description || '').slice(0, 400),
      price: num(price),
      sessions: kind === 'package' ? Math.max(1, num(sessions, 1)) : 0,
      durationDays: kind === 'membership' ? Math.max(1, num(durationDays, 30)) : 0,
      value: kind === 'giftcard' ? Math.max(1, num(value, price)) : 0,
      serviceTitle: (serviceTitle || '').trim(),
      color: color || '#6366f1',
    });
    res.status(201).json({ success: true, offer });
  } catch (e) { console.error('[CREATE_OFFER]', e.message); res.status(500).json({ success: false, message: 'Could not create offer.' }); }
};

export const updateOffer = async (req, res) => {
  try {
    const offer = await Package.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!offer) return res.status(404).json({ success: false, message: 'Offer not found.' });
    const f = req.body;
    ['name', 'description', 'serviceTitle', 'color'].forEach((k) => { if (f[k] !== undefined) offer[k] = f[k]; });
    ['price', 'sessions', 'durationDays', 'value'].forEach((k) => { if (f[k] !== undefined) offer[k] = num(f[k]); });
    if (f.active !== undefined) offer.active = !!f.active;
    await offer.save();
    res.json({ success: true, offer });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not update offer.' }); }
};

export const deleteOffer = async (req, res) => {
  try {
    const r = await Package.deleteOne({ _id: req.params.id, ownerId: req.user._id });
    if (!r.deletedCount) return res.status(404).json({ success: false, message: 'Offer not found.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not delete offer.' }); }
};

/* ── ISSUED / SOLD instances ─────────────────────────────────────────────── */

export const getIssued = async (req, res) => {
  try {
    const filter = { ownerId: req.user._id };
    if (req.query.kind && KINDS.includes(req.query.kind)) filter.kind = req.query.kind;
    if (req.query.status) filter.status = req.query.status;
    const issued = await CustomerPackage.find(filter).sort({ createdAt: -1 }).limit(300);
    res.json({ success: true, issued });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not load records.' }); }
};

// Sell / issue an offer to a customer
export const issueOffer = async (req, res) => {
  try {
    const { offerId, customerName, customerEmail, customerPhone, pricePaid } = req.body;
    const offer = await Package.findOne({ _id: offerId, ownerId: req.user._id });
    if (!offer) return res.status(404).json({ success: false, message: 'Offer not found.' });

    const doc = {
      ownerId: req.user._id,
      packageId: offer._id,
      kind: offer.kind,
      name: offer.name,
      customerName: (customerName || '').trim(),
      customerEmail: (customerEmail || '').trim().toLowerCase(),
      customerPhone: (customerPhone || '').trim(),
      pricePaid: pricePaid !== undefined ? num(pricePaid) : offer.price,
      status: 'active',
    };

    if (offer.kind === 'package') {
      doc.sessionsTotal = offer.sessions;
      doc.sessionsUsed = 0;
    } else if (offer.kind === 'membership') {
      doc.startsAt = new Date();
      doc.expiresAt = new Date(Date.now() + offer.durationDays * 86400000);
    } else if (offer.kind === 'giftcard') {
      doc.value = offer.value;
      doc.balance = offer.value;
      doc.code = genCode();
    }

    const issued = await CustomerPackage.create(doc);
    res.status(201).json({ success: true, issued });
  } catch (e) { console.error('[ISSUE_OFFER]', e.message); res.status(500).json({ success: false, message: 'Could not issue.' }); }
};

// Redeem: use a session, or redeem a gift amount
export const redeemIssued = async (req, res) => {
  try {
    const cp = await CustomerPackage.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!cp) return res.status(404).json({ success: false, message: 'Record not found.' });
    if (cp.status !== 'active') return res.status(400).json({ success: false, message: 'This is no longer active.' });

    const amount = num(req.body.amount, cp.kind === 'package' ? 1 : 0);
    const note = (req.body.note || '').slice(0, 120);

    if (cp.kind === 'package') {
      if (cp.sessionsUsed >= cp.sessionsTotal) return res.status(400).json({ success: false, message: 'No sessions left.' });
      cp.sessionsUsed += 1;
      if (cp.sessionsUsed >= cp.sessionsTotal) cp.status = 'used';
      cp.redemptions.push({ amount: 1, note });
    } else if (cp.kind === 'giftcard') {
      if (amount <= 0) return res.status(400).json({ success: false, message: 'Enter a redeem amount.' });
      if (amount > cp.balance) return res.status(400).json({ success: false, message: 'Amount exceeds balance.' });
      cp.balance = Math.round((cp.balance - amount) * 1000) / 1000;
      if (cp.balance <= 0) cp.status = 'used';
      cp.redemptions.push({ amount, note });
    } else if (cp.kind === 'membership') {
      cp.redemptions.push({ amount: 1, note: note || 'Visit' });
    }

    await cp.save();
    res.json({ success: true, issued: cp });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not redeem.' }); }
};

export const cancelIssued = async (req, res) => {
  try {
    const cp = await CustomerPackage.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!cp) return res.status(404).json({ success: false, message: 'Record not found.' });
    cp.status = 'cancelled';
    await cp.save();
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not cancel.' }); }
};

export const getPackageStats = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const now = new Date();
    const [offers, issuedActive, gcOutstanding, revenueAgg] = await Promise.all([
      Package.countDocuments({ ownerId, active: true }),
      CustomerPackage.countDocuments({ ownerId, status: 'active' }),
      CustomerPackage.aggregate([
        { $match: { ownerId, kind: 'giftcard', status: 'active' } },
        { $group: { _id: null, total: { $sum: '$balance' } } },
      ]),
      CustomerPackage.aggregate([
        { $match: { ownerId } },
        { $group: { _id: null, total: { $sum: '$pricePaid' } } },
      ]),
    ]);
    // lazy-expire memberships
    await CustomerPackage.updateMany({ ownerId, kind: 'membership', status: 'active', expiresAt: { $lt: now } }, { status: 'expired' });

    res.json({
      success: true,
      stats: {
        activeOffers: offers,
        activeIssued: issuedActive,
        giftOutstanding: gcOutstanding[0]?.total || 0,
        totalRevenue: revenueAgg[0]?.total || 0,
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: 'Stats unavailable.' }); }
};

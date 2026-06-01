import BlockedCustomer from '../models/BlockedCustomer.js';
import Booking from '../models/Booking.js';

// GET /api/merchant/no-show/blocked
export const getBlocked = async (req, res) => {
  try {
    const blocked = await BlockedCustomer.find({ ownerId: req.user._id }).sort({ createdAt: -1 });
    res.json({ success: true, blocked });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not load blocked list.' }); }
};

// POST /api/merchant/no-show/block  { name, email, phone, reason }
export const blockCustomer = async (req, res) => {
  try {
    const { name, email, phone, reason } = req.body;
    if (!email && !phone) return res.status(400).json({ success: false, message: 'Email or phone is required.' });
    const filter = { ownerId: req.user._id, email: (email || '').toLowerCase().trim(), phone: (phone || '').trim() };
    const blocked = await BlockedCustomer.findOneAndUpdate(
      filter,
      { $set: { name: (name || '').trim(), reason: (reason || '').slice(0, 200) }, $setOnInsert: filter },
      { new: true, upsert: true, runValidators: true }
    );
    res.status(201).json({ success: true, blocked });
  } catch (e) { console.error('[BLOCK_CUSTOMER]', e.message); res.status(500).json({ success: false, message: 'Could not block.' }); }
};

// DELETE /api/merchant/no-show/blocked/:id
export const unblockCustomer = async (req, res) => {
  try {
    const r = await BlockedCustomer.deleteOne({ _id: req.params.id, ownerId: req.user._id });
    if (!r.deletedCount) return res.status(404).json({ success: false, message: 'Not found.' });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not unblock.' }); }
};

// GET /api/merchant/no-show/offenders — customers with repeated no-shows (not already blocked)
export const getOffenders = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const agg = await Booking.aggregate([
      { $match: { ownerId, status: 'no-show', customerEmail: { $ne: '' } } },
      { $group: {
        _id: { $toLower: '$customerEmail' },
        name: { $first: '$customerName' },
        phone: { $first: '$customerPhone' },
        noShows: { $sum: 1 },
        lastAt: { $max: '$appointmentDate' },
      } },
      { $match: { noShows: { $gte: 2 } } },
      { $sort: { noShows: -1 } },
      { $limit: 50 },
    ]);

    const blocked = await BlockedCustomer.find({ ownerId }).select('email phone').lean();
    const blockedEmails = new Set(blocked.map((b) => b.email).filter(Boolean));
    const offenders = agg
      .filter((o) => !blockedEmails.has(o._id))
      .map((o) => ({ email: o._id, name: o.name, phone: o.phone, noShows: o.noShows, lastAt: o.lastAt }));

    res.json({ success: true, offenders });
  } catch (e) { console.error('[OFFENDERS]', e.message); res.status(500).json({ success: false, message: 'Could not load offenders.' }); }
};

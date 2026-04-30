import Booking from '../models/Booking.js';
import Consultation from '../models/Consultation.js';

const toMoneyNumber = (v) => {
  if (v === null || v === undefined) return 0;
  const s = String(v).replace(/[^0-9.]/g, '');
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : 0;
};

const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);

export const getOwnerInsightsSummary = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const [consultationsDone, bookingsTotal, bookingsCompleted] = await Promise.all([
      Consultation.find({ ownerId, status: 'done' }).select('servicePrice endedAt customerEmail customerPhone'),
      Booking.countDocuments({ ownerId }),
      Booking.countDocuments({ ownerId, status: 'completed' }),
    ]);

    const totalRevenue = consultationsDone.reduce((sum, c) => sum + toMoneyNumber(c.servicePrice), 0);
    const totalConsultations = consultationsDone.length;
    const avgTicket = totalConsultations ? totalRevenue / totalConsultations : 0;

    const since30d = daysAgo(30);
    const newCustomersSet = new Set();
    consultationsDone.forEach((c) => {
      if (c.endedAt && new Date(c.endedAt) >= since30d) {
        const key = (c.customerEmail || c.customerPhone || '').toString().trim().toLowerCase();
        if (key) newCustomersSet.add(key);
      }
    });

    return res.status(200).json({
      success: true,
      data: {
        totalRevenue,
        totalConsultations,
        totalBookings: bookingsTotal,
        bookingsCompleted,
        newCustomers30d: newCustomersSet.size,
        avgTicket,
      },
    });
  } catch (error) {
    console.error(`[INSIGHTS_SUMMARY_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to load insights summary.' });
  }
};

export const getOwnerCustomers = async (req, res) => {
  try {
    const ownerId = req.user._id;

    const doneConsultations = await Consultation.find({ ownerId, status: 'done' })
      .select('customerName customerEmail customerPhone servicePrice endedAt dateString timeSlot')
      .sort({ endedAt: -1 })
      .limit(800);

    const byKey = new Map();
    for (const c of doneConsultations) {
      const keyRaw = (c.customerEmail || c.customerPhone || '').toString().trim().toLowerCase();
      if (!keyRaw) continue;

      const prev = byKey.get(keyRaw) || {
        customerKey: keyRaw,
        name: c.customerName || 'Client',
        email: c.customerEmail || '',
        phone: c.customerPhone || '',
        visits: 0,
        spend: 0,
        lastVisitAt: c.endedAt || null,
        lastVisitLabel: `${c.dateString || ''} ${c.timeSlot || ''}`.trim(),
      };

      prev.visits += 1;
      prev.spend += toMoneyNumber(c.servicePrice);
      if (!prev.lastVisitAt || (c.endedAt && new Date(c.endedAt) > new Date(prev.lastVisitAt))) {
        prev.lastVisitAt = c.endedAt || prev.lastVisitAt;
        prev.lastVisitLabel = `${c.dateString || ''} ${c.timeSlot || ''}`.trim();
      }
      byKey.set(keyRaw, prev);
    }

    const customers = Array.from(byKey.values())
      .sort((a, b) => (b.lastVisitAt ? new Date(b.lastVisitAt).getTime() : 0) - (a.lastVisitAt ? new Date(a.lastVisitAt).getTime() : 0))
      .slice(0, 500)
      .map((c) => ({
        ...c,
        status: c.visits >= 10 ? 'VIP' : c.visits >= 2 ? 'Regular' : 'New',
      }));

    return res.status(200).json({ success: true, data: customers });
  } catch (error) {
    console.error(`[INSIGHTS_CUSTOMERS_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to load customers.' });
  }
};

export const getOwnerCustomerHistory = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const customerKey = String(req.params.customerKey || '').toLowerCase().trim();
    if (!customerKey) return res.status(400).json({ success: false, message: 'Invalid customer key.' });

    const filter = { ownerId, status: 'done', $or: [{ customerEmail: customerKey }, { customerPhone: customerKey }] };
    const data = await Consultation.find(filter).sort({ endedAt: -1 }).limit(50);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`[INSIGHTS_CUSTOMER_HISTORY_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to load customer history.' });
  }
};


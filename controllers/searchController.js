import Booking  from '../models/Booking.js';
import Staff    from '../models/Staff.js';
import Customer from '../models/Customer.js';

/**
 * Unified search across bookings, customers, staff.
 * GET /api/merchant/search?q=query
 */
export const globalSearch = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const q = (req.query.q || '').trim();
    if (!q || q.length < 2) {
      return res.status(200).json({ success: true, results: { bookings: [], customers: [], staff: [] } });
    }

    const regex = new RegExp(q, 'i');

    const [bookings, customers, staff] = await Promise.all([
      Booking.find({
        ownerId,
        $or: [
          { customerName:  regex },
          { customerEmail: regex },
          { 'service.title': regex },
        ],
      })
        .sort({ createdAt: -1 })
        .limit(6)
        .select('customerName customerEmail service dateString timeSlot status _id'),

      Customer.find({
        ownerId,
        $or: [{ name: regex }, { email: regex }, { phone: regex }],
      })
        .sort({ createdAt: -1 })
        .limit(5)
        .select('name email phone _id'),

      Staff.find({
        ownerId,
        $or: [{ name: regex }, { email: regex }, { role: regex }],
        status: { $ne: 'inactive' },
      })
        .limit(4)
        .select('name email role status _id'),
    ]);

    res.status(200).json({ success: true, results: { bookings, customers, staff } });
  } catch (err) {
    console.error('[SEARCH_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Search failed.' });
  }
};

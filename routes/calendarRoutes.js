import express from 'express';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { buildBookingICS } from '../utils/ics.js';

const router = express.Router();

/**
 * Owner iCal feed (one-way export).
 * Public read, but hard to guess URL: /api/public/calendar/:ownerId/ical
 * You can later add a secret feed token if you want.
 */
router.get('/:ownerId/ical', async (req, res) => {
  try {
    const { ownerId } = req.params;
    const owner = await User.findById(ownerId).select('businessName fullName');
    if (!owner) return res.status(404).send('Owner not found');

    const bookings = await Booking.find({
      ownerId,
      status: { $in: ['pending', 'confirmed'] },
      appointmentDate: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    })
      .sort({ appointmentDate: 1 })
      .limit(500);

    const events = bookings
      .map((b) => {
        const start = new Date(b.appointmentDate);
        const end = new Date(start.getTime() + (Number(b.service?.duration || 30) * 60 * 1000));
        return buildBookingICS({
          uid: `${b._id}@bookiify`,
          title: `${b.service?.title} - ${b.customerName}`,
          description: `Booking for ${b.customerName} (${b.customerPhone})`,
          start,
          end,
          location: owner.businessName || '',
        });
      })
      .join('\r\n');

    // This is a simple multi-event feed by concatenating VEVENT blocks.
    // Keep it minimal for compatibility.
    const feed = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//Bookiify//OwnerFeed//EN',
      'CALSCALE:GREGORIAN',
      bookings
        .map((b) => {
          const start = new Date(b.appointmentDate);
          const end = new Date(start.getTime() + (Number(b.service?.duration || 30) * 60 * 1000));
          const single = buildBookingICS({
            uid: `${b._id}@bookiify`,
            title: `${b.service?.title} - ${b.customerName}`,
            description: `Booking for ${b.customerName} (${b.customerPhone})`,
            start,
            end,
            location: owner.businessName || '',
          });
          // Extract VEVENT only
          const lines = single.split('\r\n');
          const startIdx = lines.indexOf('BEGIN:VEVENT');
          const endIdx = lines.indexOf('END:VEVENT');
          return startIdx >= 0 && endIdx >= 0 ? lines.slice(startIdx, endIdx + 1).join('\r\n') : '';
        })
        .filter(Boolean)
        .join('\r\n'),
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `inline; filename="bookiify-${ownerId}.ics"`);
    return res.status(200).send(feed);
  } catch {
    return res.status(500).send('Failed to build calendar.');
  }
});

export default router;


import express from 'express';
import {
  getBookingInfo,
  getAvailableSlots,
  createBooking,
  getMyBookings,
  getBookingDetail,
  updateBookingStatus,
  rescheduleBooking,
} from '../controllers/bookingController.js';
import { protect } from '../middleware/authMiddleware.js';

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC BOOKING ROUTER
   Mount at: /api/public/booking
   ───────────────────────────────────────────────────────────────────────────── */
const publicBookingRouter = express.Router();

// GET  /api/public/booking/:merchantId          → Services + hours info
publicBookingRouter.get('/:merchantId', getBookingInfo);

// GET  /api/public/booking/:merchantId/slots    → Available time slots
// Query: ?date=2026-04-15&duration=30&excludeBookingId=xxx
publicBookingRouter.get('/:merchantId/slots', getAvailableSlots);

// POST /api/public/booking/:merchantId          → Create a booking
publicBookingRouter.post('/:merchantId', createBooking);

export { publicBookingRouter };

/* ─────────────────────────────────────────────────────────────────────────────
   OWNER (PRIVATE) BOOKING ROUTER
   Mount at: /api/merchant/bookings
   All routes require the protect middleware.
   ───────────────────────────────────────────────────────────────────────────── */
const ownerBookingRouter = express.Router();

// GET    /api/merchant/bookings                          → Paginated list with filters
// Query: ?status=pending&date=2026-04-15&search=sami&page=1&limit=15
ownerBookingRouter.get('/', protect, getMyBookings);

// GET    /api/merchant/bookings/:bookingId               → Single booking detail
ownerBookingRouter.get('/:bookingId', protect, getBookingDetail);

// PATCH  /api/merchant/bookings/:bookingId/status        → Update status
ownerBookingRouter.patch('/:bookingId/status', protect, updateBookingStatus);

// PATCH  /api/merchant/bookings/:bookingId/reschedule    → Reschedule to new date+time
ownerBookingRouter.patch('/:bookingId/reschedule', protect, rescheduleBooking);

export { ownerBookingRouter };
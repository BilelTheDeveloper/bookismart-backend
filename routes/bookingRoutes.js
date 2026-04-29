import express from 'express';
import {
  getBookingInfo,
  getAvailableSlots,
  createBooking,
  getMyBookings,
  updateBookingStatus,
} from '../controllers/bookingController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

/* ─────────────────────────────────────────────────────────────────────────────
   PUBLIC BOOKING ROUTES (No Auth Required)
   ───────────────────────────────────────────────────────────────────────────── */

// GET  /api/public/booking/:merchantId           → Services + hours info
router.get('/:merchantId', getBookingInfo);

// GET  /api/public/booking/:merchantId/slots     → Available time slots
// Query: ?date=2026-04-15&duration=30
router.get('/:merchantId/slots', getAvailableSlots);

// POST /api/public/booking/:merchantId           → Create a booking
router.post('/:merchantId', createBooking);

/* ─────────────────────────────────────────────────────────────────────────────
   PRIVATE OWNER ROUTES (Auth Required)
   ───────────────────────────────────────────────────────────────────────────── */

// GET   /api/merchant/bookings                         → Dashboard bookings list
// PATCH /api/merchant/bookings/:bookingId/status       → Update status

export { router as publicBookingRouter };

// Separate router for protected owner routes
const ownerRouter = express.Router();

ownerRouter.get('/', protect, getMyBookings);
ownerRouter.patch('/:bookingId/status', protect, updateBookingStatus);

export { ownerRouter as ownerBookingRouter };
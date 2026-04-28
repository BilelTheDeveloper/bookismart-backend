import express from 'express';
import { 
  createBooking, 
  getOwnerBookings, 
  updateBookingStatus 
} from '../controllers/bookingController.js';
import { protect } from '../middleware/authMiddleware.js'; // Your existing auth shield
import rateLimit from 'express-rate-limit';

const router = express.Router();

/**
 * 🛡️ SECURITY: Rate limiting for public bookings
 * Prevents bots from spamming the owner's calendar
 */
const bookingLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // Limit each IP to 5 booking requests per window
  message: { success: false, message: "Too many booking attempts. Please try again in 15 minutes." }
});

// --- PUBLIC ROUTES (Used by the Makeup Template) ---

/**
 * @route   POST /api/bookings/new
 * @desc    Customer creates a booking
 */
router.post('/new', bookingLimiter, createBooking);


// --- PRIVATE ROUTES (Used by the Owner Dashboard) ---

/**
 * @route   GET /api/bookings/my-appointments
 * @desc    Owner views all their bookings
 */
router.get('/my-appointments', protect, getOwnerBookings);

/**
 * @route   PATCH /api/bookings/:id/status
 * @desc    Owner confirms or cancels a booking
 */
router.patch('/:id/status', protect, updateBookingStatus);

export default router;
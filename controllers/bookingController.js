import Booking from '../models/Booking.js';
import Website from '../models/Website.js';
import User from '../models/User.js';

/**
 * 📅 BOOKING CONTROLLER
 * Handles the full public booking flow:
 * 1. Fetch services for a merchant's website (by merchantId / ownerId)
 * 2. Fetch available time slots for a given date
 * 3. Create a new booking
 */

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

/**
 * Generate time slots for a given day based on businessHours config.
 * Returns array of "HH:MM" strings at 30-minute intervals.
 */
const generateTimeSlots = (openTime, closeTime, durationMinutes = 30) => {
  const slots = [];
  const [openH, openM] = openTime.split(':').map(Number);
  const [closeH, closeM] = closeTime.split(':').map(Number);

  let current = openH * 60 + openM;
  const end = closeH * 60 + closeM;

  while (current + durationMinutes <= end) {
    const h = Math.floor(current / 60).toString().padStart(2, '0');
    const m = (current % 60).toString().padStart(2, '0');
    slots.push(`${h}:${m}`);
    current += durationMinutes;
  }

  return slots;
};

const getDayName = (date) => {
  return new Date(date).toLocaleDateString('en-US', { weekday: 'long' });
};

/* ─────────────────────────────────────────────────────────────────────────────
   1. GET MERCHANT BOOKING INFO (Services + Business Hours)
   @route  GET /api/public/booking/:merchantId
   @access Public
   ───────────────────────────────────────────────────────────────────────────── */
export const getBookingInfo = async (req, res) => {
  try {
    const { merchantId } = req.params;

    // merchantId here is the ownerId (the User._id) — matches Website.ownerId
    const website = await Website.findOne({
      ownerId: merchantId,
      verificationStatus: 'approved',
      isPublished: true,
    }).populate('ownerId', 'fullName businessName ville category profilePicUrl');

    if (!website) {
      return res.status(404).json({
        success: false,
        message: 'This business profile is not available or pending review.',
      });
    }

    const activeServices = website.services.filter((s) => s.active !== false);

    res.status(200).json({
      success: true,
      data: {
        merchantId,
        businessName: website.ownerId.businessName,
        fullName: website.ownerId.fullName,
        ville: website.ownerId.ville,
        category: website.ownerId.category,
        profilePicUrl: website.ownerId.profilePicUrl || null,
        slug: website.slug,
        services: activeServices,
        businessHours: website.businessHours || [],
        contact: website.contact || {},
      },
    });
  } catch (error) {
    console.error(`🚨 [BOOKING_INFO_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to load booking info.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   2. GET AVAILABLE TIME SLOTS FOR A DATE
   @route  GET /api/public/booking/:merchantId/slots?date=2026-04-15&duration=30
   @access Public
   ───────────────────────────────────────────────────────────────────────────── */
export const getAvailableSlots = async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { date, duration } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required.' });
    }

    // 1. Validate date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date);
    requestedDate.setHours(0, 0, 0, 0);

    if (requestedDate < today) {
      return res.status(400).json({ success: false, message: 'Cannot book in the past.' });
    }

    // 2. Get business hours
    const website = await Website.findOne({ ownerId: merchantId });
    if (!website) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    const dayName = getDayName(date);
    const dayConfig = website.businessHours.find((d) => d.day === dayName);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(200).json({
        success: true,
        data: {
          date,
          dayName,
          isClosed: true,
          slots: [],
        },
      });
    }

    // 3. Generate all possible slots
    const serviceDuration = parseInt(duration) || 30;
    const allSlots = generateTimeSlots(dayConfig.open, dayConfig.close, serviceDuration);

    // 4. Find already-booked slots for that day
    const bookedSlots = await Booking.find({
      ownerId: merchantId,
      dateString: date,
      status: { $in: ['pending', 'confirmed'] },
    }).select('timeSlot');

    const takenTimes = new Set(bookedSlots.map((b) => b.timeSlot));

    // 5. Build enriched slot list
    const slots = allSlots.map((time) => ({
      time,
      available: !takenTimes.has(time),
    }));

    res.status(200).json({
      success: true,
      data: {
        date,
        dayName,
        isClosed: false,
        open: dayConfig.open,
        close: dayConfig.close,
        slots,
      },
    });
  } catch (error) {
    console.error(`🚨 [SLOTS_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to load time slots.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   3. CREATE A BOOKING
   @route  POST /api/public/booking/:merchantId
   @access Public
   ───────────────────────────────────────────────────────────────────────────── */
export const createBooking = async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { customerName, customerEmail, customerPhone, service, date, timeSlot, notes } = req.body;

    // 1. Validate required fields
    if (!customerName || !customerEmail || !customerPhone || !service || !date || !timeSlot) {
      return res.status(400).json({
        success: false,
        message: 'Missing required booking fields.',
      });
    }

    // 2. Check date is not in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDate = new Date(date);
    bookingDate.setHours(0, 0, 0, 0);

    if (bookingDate < today) {
      return res.status(400).json({ success: false, message: 'Cannot book in the past.' });
    }

    // 3. Verify the merchant/owner exists
    const owner = await User.findById(merchantId).select('_id accountStatus');
    if (!owner || owner.accountStatus === 'suspended') {
      return res.status(404).json({ success: false, message: 'Merchant not found or suspended.' });
    }

    // 4. Check slot is not already taken (race condition protection)
    const conflict = await Booking.findOne({
      ownerId: merchantId,
      dateString: date,
      timeSlot,
      status: { $in: ['pending', 'confirmed'] },
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: 'This time slot was just taken. Please pick another.',
        code: 'SLOT_CONFLICT',
      });
    }

    // 5. Verify business is open on that day
    const website = await Website.findOne({ ownerId: merchantId });
    const dayName = getDayName(date);
    const dayConfig = website?.businessHours?.find((d) => d.day === dayName);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(400).json({
        success: false,
        message: `This business is closed on ${dayName}.`,
      });
    }

    // 6. Create the booking
    const appointmentDate = new Date(`${date}T${timeSlot}:00`);

    const booking = await Booking.create({
      ownerId: merchantId,
      merchantId, // same as ownerId for now; can be extended for multi-merchant
      customerName: customerName.trim(),
      customerEmail: customerEmail.toLowerCase().trim(),
      customerPhone: customerPhone.trim(),
      service: {
        title: service.title,
        price: service.price || 'N/A',
        duration: service.duration || 30,
      },
      appointmentDate,
      dateString: date,
      timeSlot,
      dayOfWeek: dayName,
      notes: notes?.trim() || '',
      status: 'pending',
    });

    res.status(201).json({
      success: true,
      message: 'Booking confirmed! The business will reach out to confirm your appointment.',
      data: {
        bookingId: booking._id,
        customerName: booking.customerName,
        service: booking.service.title,
        date: booking.dateString,
        time: booking.timeSlot,
        status: booking.status,
      },
    });
  } catch (error) {
    console.error(`🚨 [BOOKING_CREATE_ERROR]: ${error.message}`);

    // Duplicate key = race condition on the unique index
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'This time slot was just taken. Please pick another.',
        code: 'SLOT_CONFLICT',
      });
    }

    res.status(500).json({ success: false, message: 'Booking failed. Please try again.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   4. GET OWNER'S BOOKINGS (Dashboard)
   @route  GET /api/merchant/bookings
   @access Private
   ───────────────────────────────────────────────────────────────────────────── */
export const getMyBookings = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { status, date, page = 1, limit = 20 } = req.query;

    const filter = { ownerId };
    if (status) filter.status = status;
    if (date) filter.dateString = date;

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ appointmentDate: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Booking.countDocuments(filter),
    ]);

    res.status(200).json({
      success: true,
      data: bookings,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    console.error(`🚨 [MY_BOOKINGS_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to load bookings.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   5. UPDATE BOOKING STATUS (Owner Dashboard)
   @route  PATCH /api/merchant/bookings/:bookingId/status
   @access Private
   ───────────────────────────────────────────────────────────────────────────── */
export const updateBookingStatus = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { bookingId } = req.params;
    const { status } = req.body;

    const allowed = ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status value.' });
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, ownerId },
      { status },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    console.error(`🚨 [BOOKING_STATUS_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to update booking status.' });
  }
};
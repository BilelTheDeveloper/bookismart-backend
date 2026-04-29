import Booking from '../models/Booking.js';
import Website from '../models/Website.js';
import User from '../models/User.js';

/**
 * 📅 BOOKING CONTROLLER
 * Handles the full public booking flow AND the owner dashboard management flow.
 */

/* ─────────────────────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────────────────────── */

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

const getDayName = (date) =>
  new Date(date).toLocaleDateString('en-US', { weekday: 'long' });

/* ─────────────────────────────────────────────────────────────────────────────
   1. GET MERCHANT BOOKING INFO (Services + Business Hours)
   @route  GET /api/public/booking/:merchantId
   @access Public
   ───────────────────────────────────────────────────────────────────────────── */
export const getBookingInfo = async (req, res) => {
  try {
    const { merchantId } = req.params;

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
   @route  GET /api/public/booking/:merchantId/slots
   @query  date, duration, excludeBookingId (optional — for reschedule flow)
   @access Public + Private (owner reschedule uses excludeBookingId)
   ───────────────────────────────────────────────────────────────────────────── */
export const getAvailableSlots = async (req, res) => {
  try {
    const { merchantId } = req.params;
    const { date, duration, excludeBookingId } = req.query;

    if (!date) {
      return res.status(400).json({ success: false, message: 'Date is required.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date);
    requestedDate.setHours(0, 0, 0, 0);

    if (requestedDate < today) {
      return res.status(400).json({ success: false, message: 'Cannot book in the past.' });
    }

    const website = await Website.findOne({ ownerId: merchantId });
    if (!website) {
      return res.status(404).json({ success: false, message: 'Business not found.' });
    }

    const dayName = getDayName(date);
    const dayConfig = website.businessHours.find((d) => d.day === dayName);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(200).json({
        success: true,
        data: { date, dayName, isClosed: true, slots: [] },
      });
    }

    const serviceDuration = parseInt(duration) || 30;
    const allSlots = generateTimeSlots(dayConfig.open, dayConfig.close, serviceDuration);

    // When rescheduling, exclude the current booking so its slot appears free
    const bookingFilter = {
      ownerId: merchantId,
      dateString: date,
      status: { $in: ['pending', 'confirmed'] },
    };
    if (excludeBookingId) {
      bookingFilter._id = { $ne: excludeBookingId };
    }

    const bookedSlots = await Booking.find(bookingFilter).select('timeSlot');
    const takenTimes = new Set(bookedSlots.map((b) => b.timeSlot));

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

    if (!customerName || !customerEmail || !customerPhone || !service || !date || !timeSlot) {
      return res.status(400).json({ success: false, message: 'Missing required booking fields.' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDate = new Date(date);
    bookingDate.setHours(0, 0, 0, 0);

    if (bookingDate < today) {
      return res.status(400).json({ success: false, message: 'Cannot book in the past.' });
    }

    const owner = await User.findById(merchantId).select('_id accountStatus');
    if (!owner || owner.accountStatus === 'suspended') {
      return res.status(404).json({ success: false, message: 'Merchant not found or suspended.' });
    }

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

    const website = await Website.findOne({ ownerId: merchantId });
    const dayName = getDayName(date);
    const dayConfig = website?.businessHours?.find((d) => d.day === dayName);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(400).json({
        success: false,
        message: `This business is closed on ${dayName}.`,
      });
    }

    const appointmentDate = new Date(`${date}T${timeSlot}:00`);

    const booking = await Booking.create({
      ownerId: merchantId,
      merchantId,
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
   @query  status, date, search, page, limit
   ───────────────────────────────────────────────────────────────────────────── */
export const getMyBookings = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { status, date, search, page = 1, limit = 15 } = req.query;

    const filter = { ownerId };
    if (status && status !== 'all') filter.status = status;
    if (date) filter.dateString = date;
    if (search) {
      const regex = new RegExp(search.trim(), 'i');
      filter.$or = [
        { customerName: regex },
        { customerEmail: regex },
        { customerPhone: regex },
        { 'service.title': regex },
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [bookings, total] = await Promise.all([
      Booking.find(filter)
        .sort({ appointmentDate: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Booking.countDocuments(filter),
    ]);

    // Summary counts — always scoped to owner, regardless of current filter
    const [pendingCount, confirmedCount, completedCount, cancelledCount, noShowCount] =
      await Promise.all([
        Booking.countDocuments({ ownerId, status: 'pending' }),
        Booking.countDocuments({ ownerId, status: 'confirmed' }),
        Booking.countDocuments({ ownerId, status: 'completed' }),
        Booking.countDocuments({ ownerId, status: 'cancelled' }),
        Booking.countDocuments({ ownerId, status: 'no-show' }),
      ]);

    res.status(200).json({
      success: true,
      data: bookings,
      summary: {
        pending: pendingCount,
        confirmed: confirmedCount,
        completed: completedCount,
        cancelled: cancelledCount,
        noShow: noShowCount,
        total: pendingCount + confirmedCount + completedCount + cancelledCount + noShowCount,
      },
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
   5. GET SINGLE BOOKING DETAIL (Owner Dashboard)
   @route  GET /api/merchant/bookings/:bookingId
   @access Private
   ───────────────────────────────────────────────────────────────────────────── */
export const getBookingDetail = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ _id: bookingId, ownerId });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    res.status(200).json({ success: true, data: booking });
  } catch (error) {
    console.error(`🚨 [BOOKING_DETAIL_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Failed to load booking.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   6. UPDATE BOOKING STATUS (Owner Dashboard)
   @route  PATCH /api/merchant/bookings/:bookingId/status
   @access Private
   @body   { status: 'confirmed' | 'completed' | 'cancelled' | 'no-show' | 'pending' }
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

/* ─────────────────────────────────────────────────────────────────────────────
   7. RESCHEDULE A BOOKING (Owner Dashboard)
   @route  PATCH /api/merchant/bookings/:bookingId/reschedule
   @access Private
   @body   { date: "2026-04-20", timeSlot: "14:30" }
   ───────────────────────────────────────────────────────────────────────────── */
export const rescheduleBooking = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { bookingId } = req.params;
    const { date, timeSlot } = req.body;

    if (!date || !timeSlot) {
      return res.status(400).json({ success: false, message: 'New date and time are required.' });
    }

    // 1. Find booking and verify ownership
    const booking = await Booking.findOne({ _id: bookingId, ownerId });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // 2. Cannot reschedule completed or no-show bookings
    if (['completed', 'no-show'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reschedule a ${booking.status} booking.`,
      });
    }

    // 3. Date must not be in the past
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newDate = new Date(date);
    newDate.setHours(0, 0, 0, 0);
    if (newDate < today) {
      return res.status(400).json({ success: false, message: 'Cannot reschedule to a past date.' });
    }

    // 4. Check the new slot is not taken by another booking (exclude self)
    const conflict = await Booking.findOne({
      ownerId,
      dateString: date,
      timeSlot,
      status: { $in: ['pending', 'confirmed'] },
      _id: { $ne: bookingId },
    });

    if (conflict) {
      return res.status(409).json({
        success: false,
        message: 'That time slot is already taken.',
        code: 'SLOT_CONFLICT',
      });
    }

    // 5. Verify business is open on the new day
    const website = await Website.findOne({ ownerId });
    const dayName = getDayName(date);
    const dayConfig = website?.businessHours?.find((d) => d.day === dayName);
    if (!dayConfig || dayConfig.isClosed) {
      return res.status(400).json({
        success: false,
        message: `Business is closed on ${dayName}.`,
      });
    }

    // 6. Apply the update
    const appointmentDate = new Date(`${date}T${timeSlot}:00`);
    const updated = await Booking.findByIdAndUpdate(
      bookingId,
      {
        dateString: date,
        timeSlot,
        dayOfWeek: dayName,
        appointmentDate,
        status: 'confirmed', // Auto-confirm when owner reschedules
      },
      { new: true }
    );

    res.status(200).json({
      success: true,
      message: 'Booking successfully rescheduled.',
      data: updated,
    });
  } catch (error) {
    console.error(`🚨 [RESCHEDULE_ERROR]: ${error.message}`);
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'That time slot is already taken.',
        code: 'SLOT_CONFLICT',
      });
    }
    res.status(500).json({ success: false, message: 'Reschedule failed.' });
  }
};
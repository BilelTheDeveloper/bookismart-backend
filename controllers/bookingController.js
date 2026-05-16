import Booking from '../models/Booking.js';
import Website from '../models/Website.js';
import User from '../models/User.js';
import LoyaltyProgram from '../models/LoyaltyProgram.js';
import CustomerLoyalty from '../models/CustomerLoyalty.js';
import Invoice from '../models/Invoice.js';
import { sendEmail } from '../utils/emailService.js';

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

const toMinutes = (hhmm = '00:00') => {
  const [h, m] = hhmm.split(':').map(Number);
  return (h * 60) + m;
};

const hasIntervalConflict = ({ candidateStart, candidateEnd, existingStart, existingDuration, restMinutes }) => {
  const existingEnd = existingStart + existingDuration;
  const existingEndWithRest = existingEnd + restMinutes;
  const candidateEndWithRest = candidateEnd + restMinutes;

  const candidateBeforeExisting = candidateEndWithRest <= existingStart;
  const existingBeforeCandidate = existingEndWithRest <= candidateStart;

  return !(candidateBeforeExisting || existingBeforeCandidate);
};

const isInPauseWindow = ({ candidateStart, candidateEnd, pauseWindows }) => {
  return pauseWindows.some((pause) => {
    const pauseStart = toMinutes(pause.start);
    const pauseEnd = toMinutes(pause.end);
    return candidateStart < pauseEnd && candidateEnd > pauseStart;
  });
};

/**
 * Returns the effective hours config for a given date.
 * Seasonal overrides take priority over regular businessHours.
 * Compares ISO date strings (YYYY-MM-DD) — string comparison is safe for this format.
 */
const resolveHoursForDate = (website, dateString) => {
  const overrides = (website.seasonalHours || []).filter(sh => sh.startDate && sh.endDate);
  for (const sh of overrides) {
    if (dateString >= sh.startDate && dateString <= sh.endDate) {
      return { open: sh.open, close: sh.close, isClosed: sh.isClosed };
    }
  }
  const dayName = getDayName(dateString);
  return (website.businessHours || []).find(d => d.day === dayName) || null;
};

/** Returns a map of { [serviceTitle]: bufferTime } for O(1) conflict lookups. */
const buildServiceBufferMap = (website) => {
  const map = {};
  (website.services || []).forEach(s => {
    if (s.title) map[s.title] = Math.max(0, parseInt(s.bufferTime) || 0);
  });
  return map;
};

/**
 * Non-blocking side-effects fired when a booking is marked 'completed' for the first time.
 * Awards loyalty points/stamps and auto-generates a draft invoice.
 */
const _onBookingCompleted = async (ownerId, booking) => {
  const customerEmail = (booking.customerEmail || '').toLowerCase().trim();
  const servicePrice = parseFloat(String(booking.service?.price || '0').replace(/[^0-9.]/g, '')) || 0;

  // 1. Award loyalty
  try {
    const program = await LoyaltyProgram.findOne({ ownerId, isActive: true });
    if (program && customerEmail) {
      const loyaltyInc = { totalVisits: 1, totalSpend: servicePrice };
      if (program.mode === 'points') loyaltyInc.points = program.pointsPerBooking || 1;
      else loyaltyInc.stamps = 1;
      await CustomerLoyalty.findOneAndUpdate(
        { ownerId, customerEmail },
        {
          $set: { customerName: booking.customerName, customerPhone: booking.customerPhone || '', lastVisitAt: new Date() },
          $inc: loyaltyInc,
        },
        { upsert: true }
      );
    }
  } catch (e) {
    console.error('[COMPLETION_LOYALTY_ERROR]', e.message);
  }

  // 2. Auto-generate a draft invoice (skip if one already exists for this booking)
  try {
    if (servicePrice > 0) {
      const exists = await Invoice.findOne({ bookingId: booking._id });
      if (!exists) {
        const taxRate = 19;
        const taxAmount = parseFloat((servicePrice * taxRate / 100).toFixed(3));
        await Invoice.create({
          ownerId,
          customer: { name: booking.customerName, email: booking.customerEmail, phone: booking.customerPhone || '' },
          bookingId: booking._id,
          items: [{ description: booking.service?.title || 'Service', quantity: 1, unitPrice: servicePrice, total: servicePrice }],
          subtotal: servicePrice,
          taxRate,
          taxAmount,
          total: servicePrice + taxAmount,
          status: 'draft',
          issuedDate: new Date(),
          dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      }
    }
  } catch (e) {
    console.error('[COMPLETION_INVOICE_ERROR]', e.message);
  }
};

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
        seasonalHours: website.seasonalHours || [],
        setupConfig: website.setupConfig || {},
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
    const dayConfig = resolveHoursForDate(website, date);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(200).json({
        success: true,
        data: { date, dayName, isClosed: true, slots: [] },
      });
    }

    const serviceDuration = parseInt(duration) || 30;
    const setupConfig = website.setupConfig || {};
    const restMinutes = Math.max(0, parseInt(setupConfig.restMinutesBetweenConsultations) || 0);
    const maxCustomersPerDay = Math.max(1, parseInt(setupConfig.maxCustomersPerDay) || 25);
    const pauseWindows = (setupConfig.pauseWindows || []).filter((p) => p?.start && p?.end && p.start < p.end);
    const serviceBufferMap = buildServiceBufferMap(website);
    const allSlots = generateTimeSlots(dayConfig.open, dayConfig.close, serviceDuration);

    const bookingFilter = {
      ownerId: merchantId,
      dateString: date,
      status: { $in: ['pending', 'confirmed'] },
    };
    if (excludeBookingId) {
      bookingFilter._id = { $ne: excludeBookingId };
    }

    const bookedSlots = await Booking.find(bookingFilter).select('timeSlot service.duration service.title');
    const isFullyBookedByLimit = bookedSlots.length >= maxCustomersPerDay;

    const slots = allSlots.map((time) => {
      const candidateStart = toMinutes(time);
      const candidateEnd = candidateStart + serviceDuration;

      if (isInPauseWindow({ candidateStart, candidateEnd, pauseWindows })) {
        return { time, available: false };
      }

      const hasConflict = bookedSlots.some((booking) => {
        const existingStart = toMinutes(booking.timeSlot);
        const existingDuration = parseInt(booking?.service?.duration) || 30;
        const existingBuffer = Math.max(restMinutes, serviceBufferMap[booking.service?.title] || 0);
        return hasIntervalConflict({
          candidateStart,
          candidateEnd,
          existingStart,
          existingDuration,
          restMinutes: existingBuffer,
        });
      });

      return {
        time,
        available: !isFullyBookedByLimit && !hasConflict,
      };
    });

    res.status(200).json({
      success: true,
      data: {
        date,
        dayName,
        isClosed: false,
        isFullyBookedByLimit,
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
   SIDE-EFFECT: Email owner on new booking (non-blocking)
   ───────────────────────────────────────────────────────────────────────────── */
const _notifyOwnerNewBooking = async (owner, booking) => {
  if (!owner?.notificationPrefs?.newBookingEmail) return;
  if (!owner.email) return;

  const dashboardUrl = `${process.env.CLIENT_URL || 'https://bookiify.vercel.app'}/owner/dashboard/appointments`;

  await sendEmail({
    to: owner.email,
    subject: `📅 New Booking — ${booking.customerName} for ${booking.service?.title}`,
    html: `
      <!DOCTYPE html>
      <html>
      <head>
        <style>
          body { margin: 0; padding: 0; background: #f8fafc; font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; }
          .wrapper { max-width: 600px; margin: 40px auto; background: #ffffff; border-radius: 24px; overflow: hidden; border: 1px solid #e2e8f0; }
          .header { background: #0f172a; padding: 32px 40px; }
          .logo { color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: -1px; }
          .logo span { color: #6366f1; }
          .badge { display: inline-block; background: #6366f1; color: #fff; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; padding: 5px 14px; border-radius: 99px; margin-top: 16px; }
          .body { padding: 40px; }
          .headline { font-size: 26px; font-weight: 900; color: #0f172a; margin: 0 0 8px; }
          .sub { font-size: 14px; color: #64748b; margin: 0 0 32px; font-weight: 500; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px; margin-bottom: 16px; }
          .card-title { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px; color: #94a3b8; margin-bottom: 16px; }
          .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f1f5f9; }
          .row:last-child { border-bottom: none; }
          .row-label { font-size: 12px; font-weight: 700; color: #64748b; }
          .row-value { font-size: 13px; font-weight: 900; color: #0f172a; }
          .highlight { color: #6366f1; }
          .btn { display: block; text-align: center; background: #6366f1; color: #ffffff !important; text-decoration: none; font-weight: 800; font-size: 14px; padding: 18px 32px; border-radius: 16px; margin-top: 32px; box-shadow: 0 8px 20px -4px #6366f150; }
          .notes-box { background: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 16px; margin-top: 16px; }
          .notes-label { font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #92400e; margin-bottom: 6px; }
          .notes-text { font-size: 13px; color: #1e293b; font-weight: 500; }
          .footer { padding: 24px 40px; border-top: 1px solid #f1f5f9; font-size: 11px; color: #94a3b8; text-align: center; }
        </style>
      </head>
      <body>
        <div class="wrapper">
          <div class="header">
            <div class="logo">BOOKIIFY<span>.</span></div>
            <div class="badge">New Booking Alert</div>
          </div>
          <div class="body">
            <h1 class="headline">You have a new booking!</h1>
            <p class="sub">A customer just scheduled an appointment. Review it below.</p>

            <div class="card">
              <div class="card-title">Customer Info</div>
              <div class="row"><span class="row-label">Name</span><span class="row-value">${booking.customerName}</span></div>
              <div class="row"><span class="row-label">Phone</span><span class="row-value">${booking.customerPhone}</span></div>
              <div class="row"><span class="row-label">Email</span><span class="row-value">${booking.customerEmail}</span></div>
            </div>

            <div class="card">
              <div class="card-title">Appointment Details</div>
              <div class="row"><span class="row-label">Service</span><span class="row-value highlight">${booking.service?.title}</span></div>
              <div class="row"><span class="row-label">Price</span><span class="row-value">${booking.service?.price || 'N/A'} TND</span></div>
              <div class="row"><span class="row-label">Duration</span><span class="row-value">${booking.service?.duration || 30} min</span></div>
              <div class="row"><span class="row-label">Date</span><span class="row-value">${booking.dateString}</span></div>
              <div class="row"><span class="row-label">Time</span><span class="row-value">${booking.timeSlot}</span></div>
              <div class="row"><span class="row-label">Day</span><span class="row-value">${booking.dayOfWeek}</span></div>
            </div>

            ${booking.notes ? `
            <div class="notes-box">
              <div class="notes-label">Customer Notes</div>
              <div class="notes-text">${booking.notes}</div>
            </div>` : ''}

            <a href="${dashboardUrl}" class="btn">VIEW BOOKING IN DASHBOARD</a>
          </div>
          <div class="footer">
            This notification was sent because you have new booking alerts enabled.<br/>
            &copy; 2026 Bookiify &mdash; You can manage notification settings in your dashboard.
          </div>
        </div>
      </body>
      </html>
    `,
  });
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

    const owner = await User.findById(merchantId).select('_id accountStatus email notificationPrefs');
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
    const setupConfig = website?.setupConfig || {};
    const restMinutes = Math.max(0, parseInt(setupConfig.restMinutesBetweenConsultations) || 0);
    const maxCustomersPerDay = Math.max(1, parseInt(setupConfig.maxCustomersPerDay) || 25);
    const pauseWindows = (setupConfig.pauseWindows || []).filter((p) => p?.start && p?.end && p.start < p.end);
    const serviceBufferMap = buildServiceBufferMap(website);
    const dayConfig = resolveHoursForDate(website, date);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(400).json({
        success: false,
        message: 'This business is closed on the selected date.',
      });
    }

    const appointmentDate = new Date(`${date}T${timeSlot}:00`);
    const serviceDuration = parseInt(service?.duration) || 30;
    const candidateStart = toMinutes(timeSlot);
    const candidateEnd = candidateStart + serviceDuration;

    if (isInPauseWindow({ candidateStart, candidateEnd, pauseWindows })) {
      return res.status(400).json({
        success: false,
        message: 'Selected time falls inside a configured pause window.',
      });
    }

    const activeBookings = await Booking.find({
      ownerId: merchantId,
      dateString: date,
      status: { $in: ['pending', 'confirmed'] },
    }).select('timeSlot service.duration service.title');

    if (activeBookings.length >= maxCustomersPerDay) {
      return res.status(409).json({
        success: false,
        message: 'Maximum number of customers reached for this day.',
        code: 'DAILY_LIMIT_REACHED',
      });
    }

    const overlapsExisting = activeBookings.some((existingBooking) => {
      const existingStart = toMinutes(existingBooking.timeSlot);
      const existingDuration = parseInt(existingBooking?.service?.duration) || 30;
      const existingBuffer = Math.max(restMinutes, serviceBufferMap[existingBooking.service?.title] || 0);
      return hasIntervalConflict({
        candidateStart,
        candidateEnd,
        existingStart,
        existingDuration,
        restMinutes: existingBuffer,
      });
    });

    if (overlapsExisting) {
      return res.status(409).json({
        success: false,
        message: 'This slot conflicts with another appointment or required rest time.',
        code: 'SLOT_CONFLICT',
      });
    }

    const booking = await Booking.create({
      ownerId: merchantId,
      merchantId,
      customerName: customerName.trim(),
      customerEmail: customerEmail.toLowerCase().trim(),
      customerPhone: customerPhone.trim(),
      service: {
        title: service.title,
        price: service.price || 'N/A',
        duration: serviceDuration,
      },
      appointmentDate,
      dateString: date,
      timeSlot,
      dayOfWeek: getDayName(date),
      notes: notes?.trim() || '',
      status: 'pending',
    });

    // Non-blocking: email owner about the new booking
    _notifyOwnerNewBooking(owner, booking).catch((err) =>
      console.error('[BOOKING_EMAIL_NOTIFY_ERROR]', err.message)
    );

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

    // Fetch current status first to detect first-time completion
    const existing = await Booking.findOne({ _id: bookingId, ownerId }).select('status');
    if (!existing) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }
    const wasAlreadyCompleted = existing.status === 'completed';

    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, ownerId },
      { status },
      { new: true }
    );

    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    // Fire non-blocking side-effects on first completion
    if (status === 'completed' && !wasAlreadyCompleted) {
      _onBookingCompleted(ownerId, booking).catch((e) =>
        console.error('[COMPLETION_HOOK_ERROR]', e.message)
      );
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

    const booking = await Booking.findOne({ _id: bookingId, ownerId });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    if (['completed', 'no-show'].includes(booking.status)) {
      return res.status(400).json({
        success: false,
        message: `Cannot reschedule a ${booking.status} booking.`,
      });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const newDate = new Date(date);
    newDate.setHours(0, 0, 0, 0);
    if (newDate < today) {
      return res.status(400).json({ success: false, message: 'Cannot reschedule to a past date.' });
    }

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

    const website = await Website.findOne({ ownerId });
    const setupConfig = website?.setupConfig || {};
    const restMinutes = Math.max(0, parseInt(setupConfig.restMinutesBetweenConsultations) || 0);
    const maxCustomersPerDay = Math.max(1, parseInt(setupConfig.maxCustomersPerDay) || 25);
    const pauseWindows = (setupConfig.pauseWindows || []).filter((p) => p?.start && p?.end && p.start < p.end);
    const serviceBufferMap = buildServiceBufferMap(website);
    const dayName = getDayName(date);
    const dayConfig = resolveHoursForDate(website, date);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(400).json({
        success: false,
        message: `Business is closed on ${dayName}.`,
      });
    }

    const serviceDuration = parseInt(booking?.service?.duration) || 30;
    const candidateStart = toMinutes(timeSlot);
    const candidateEnd = candidateStart + serviceDuration;

    if (isInPauseWindow({ candidateStart, candidateEnd, pauseWindows })) {
      return res.status(400).json({
        success: false,
        message: 'Selected time falls inside a configured pause window.',
      });
    }

    const activeBookings = await Booking.find({
      ownerId,
      dateString: date,
      status: { $in: ['pending', 'confirmed'] },
      _id: { $ne: bookingId },
    }).select('timeSlot service.duration service.title');

    if (activeBookings.length >= maxCustomersPerDay) {
      return res.status(409).json({
        success: false,
        message: 'Maximum number of customers reached for this day.',
        code: 'DAILY_LIMIT_REACHED',
      });
    }

    const overlapsExisting = activeBookings.some((existingBooking) => {
      const existingStart = toMinutes(existingBooking.timeSlot);
      const existingDuration = parseInt(existingBooking?.service?.duration) || 30;
      const existingBuffer = Math.max(restMinutes, serviceBufferMap[existingBooking.service?.title] || 0);
      return hasIntervalConflict({
        candidateStart,
        candidateEnd,
        existingStart,
        existingDuration,
        restMinutes: existingBuffer,
      });
    });

    if (overlapsExisting) {
      return res.status(409).json({
        success: false,
        message: 'That time conflicts with another appointment or rest requirement.',
        code: 'SLOT_CONFLICT',
      });
    }

    const appointmentDate = new Date(`${date}T${timeSlot}:00`);
    const updated = await Booking.findByIdAndUpdate(
      bookingId,
      {
        dateString: date,
        timeSlot,
        dayOfWeek: dayName,
        appointmentDate,
        status: 'confirmed',
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

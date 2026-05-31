import Booking from '../models/Booking.js';
import Website from '../models/Website.js';
import User from '../models/User.js';
import LoyaltyProgram from '../models/LoyaltyProgram.js';
import CustomerLoyalty from '../models/CustomerLoyalty.js';
import Invoice from '../models/Invoice.js';
import { sendEmail } from '../utils/emailService.js';
import { sendWhatsAppConfirmation, sendWhatsAppCancellation } from '../utils/messageProviders.js';
import { bustPublic, bustPrivate, bustPrivatePrefix } from '../middleware/cache.js';

const escHtml = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

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
              <div class="row"><span class="row-label">Name</span><span class="row-value">${escHtml(booking.customerName)}</span></div>
              <div class="row"><span class="row-label">Phone</span><span class="row-value">${escHtml(booking.customerPhone)}</span></div>
              <div class="row"><span class="row-label">Email</span><span class="row-value">${escHtml(booking.customerEmail)}</span></div>
            </div>

            <div class="card">
              <div class="card-title">Appointment Details</div>
              <div class="row"><span class="row-label">Service</span><span class="row-value highlight">${escHtml(booking.service?.title)}</span></div>
              <div class="row"><span class="row-label">Price</span><span class="row-value">${escHtml(booking.service?.price || 'N/A')} TND</span></div>
              <div class="row"><span class="row-label">Duration</span><span class="row-value">${escHtml(String(booking.service?.duration || 30))} min</span></div>
              <div class="row"><span class="row-label">Date</span><span class="row-value">${escHtml(booking.dateString)}</span></div>
              <div class="row"><span class="row-label">Time</span><span class="row-value">${escHtml(booking.timeSlot)}</span></div>
              <div class="row"><span class="row-label">Day</span><span class="row-value">${escHtml(booking.dayOfWeek)}</span></div>
            </div>

            ${booking.notes ? `
            <div class="notes-box">
              <div class="notes-label">Customer Notes</div>
              <div class="notes-text">${escHtml(booking.notes)}</div>
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

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: 'Invalid date format. Use YYYY-MM-DD.' });
    }
    if (!/^\d{2}:\d{2}$/.test(timeSlot)) {
      return res.status(400).json({ success: false, message: 'Invalid time format. Use HH:MM.' });
    }
    if (typeof customerName !== 'string' || customerName.length > 120) {
      return res.status(400).json({ success: false, message: 'Customer name too long.' });
    }
    if (typeof customerEmail !== 'string' || customerEmail.length > 200) {
      return res.status(400).json({ success: false, message: 'Invalid email.' });
    }
    if (typeof customerPhone !== 'string' || customerPhone.length > 30) {
      return res.status(400).json({ success: false, message: 'Invalid phone number.' });
    }
    if (notes && (typeof notes !== 'string' || notes.length > 1000)) {
      return res.status(400).json({ success: false, message: 'Notes too long (max 1000 chars).' });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const bookingDate = new Date(date);
    bookingDate.setHours(0, 0, 0, 0);

    if (isNaN(bookingDate.getTime())) {
      return res.status(400).json({ success: false, message: 'Invalid date value.' });
    }
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

    // Invalidate slots cache for this exact date — the slot is now taken
    bustPublic('slots', merchantId, date).catch(() => {});

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
    const { status, date, search } = req.query;
    const page  = Math.max(1, Math.min(1000, parseInt(req.query.page)  || 1));
    const limit = Math.max(1, Math.min(100,  parseInt(req.query.limit) || 15));

    const filter = { ownerId };
    if (status && status !== 'all') filter.status = status;
    if (date) filter.dateString = date;
    if (search) {
      const escaped = search.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const regex = new RegExp(escaped, 'i');
      filter.$or = [
        { customerName: regex },
        { customerEmail: regex },
        { customerPhone: regex },
        { 'service.title': regex },
      ];
    }

    const skip = (page - 1) * limit;

    const [bookings, total, statusAgg] = await Promise.all([
      Booking.find(filter)
        .sort({ appointmentDate: 1 })
        .skip(skip)
        .limit(limit),
      Booking.countDocuments(filter),
      Booking.aggregate([
        { $match: { ownerId } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
    ]);

    const summaryMap = { pending: 0, confirmed: 0, completed: 0, cancelled: 0, noShow: 0 };
    const statusKey = { pending: 'pending', confirmed: 'confirmed', completed: 'completed', cancelled: 'cancelled', 'no-show': 'noShow' };
    for (const { _id, count } of statusAgg) {
      if (statusKey[_id]) summaryMap[statusKey[_id]] = count;
    }
    summaryMap.total = Object.values(summaryMap).reduce((a, b) => a + b, 0);

    res.status(200).json({
      success: true,
      data: bookings,
      summary: summaryMap,
      pagination: {
        total,
        page,
        pages: Math.ceil(total / limit),
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

    const statusUpdate = { status };
    if (status === 'confirmed' && existing.status !== 'confirmed') {
      statusUpdate.confirmedAt = new Date();
    }

    const booking = await Booking.findOneAndUpdate(
      { _id: bookingId, ownerId },
      statusUpdate,
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

    // Invalidate all caches affected by a status change (fire-and-forget)
    const uid = ownerId.toString();
    Promise.all([
      bustPublic('slots', uid, booking.dateString),   // slot may have opened (cancel) or closed
      bustPrivatePrefix(uid, 'bookings:'),             // paginated booking lists
      bustPrivate(uid, 'analytics'),                   // status breakdown changed
      bustPrivate(uid, 'kpi'),                         // KPI summary changed
      bustPrivate(uid, 'customers'),                   // customer visit/spend totals may change
    ]).catch(() => {});

    // WhatsApp — confirmation and cancellation notifications
    if (status === 'confirmed' && existing.status !== 'confirmed') {
      const owner = await User.findById(ownerId).select('businessName fullName');
      const businessName = owner?.businessName || owner?.fullName || 'Bookiify Pro';
      sendWhatsAppConfirmation({
        to: booking.customerPhone,
        customerName: booking.customerName,
        businessName,
        service: booking.service?.title,
        dateString: booking.dateString,
        timeSlot: booking.timeSlot,
        price: booking.service?.price,
      }).catch((e) => console.error('[WA_CONFIRM_ERROR]', e.message));
    }

    if (status === 'cancelled' && existing.status !== 'cancelled') {
      const owner = await User.findById(ownerId).select('businessName fullName');
      const businessName = owner?.businessName || owner?.fullName || 'Bookiify Pro';
      sendWhatsAppCancellation({
        to: booking.customerPhone,
        customerName: booking.customerName,
        businessName,
        service: booking.service?.title,
        dateString: booking.dateString,
        timeSlot: booking.timeSlot,
      }).catch((e) => console.error('[WA_CANCEL_ERROR]', e.message));
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

    // Invalidate slots for both the old date (slot freed) and new date (slot taken)
    const uid = ownerId.toString();
    Promise.all([
      bustPublic('slots', uid, booking.dateString), // old date — slot freed
      bustPublic('slots', uid, date),               // new date — slot taken
      bustPrivatePrefix(uid, 'bookings:'),           // list changed
    ]).catch(() => {});

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

/* ─────────────────────────────────────────────────────────────────────────────
   8. SEND REVIEW REQUEST (Owner Dashboard)
   @route  POST /api/merchant/bookings/:bookingId/review-request
   @access Private
   ───────────────────────────────────────────────────────────────────────────── */
export const sendReviewRequest = async (req, res) => {
  try {
    const ownerId  = req.user._id;
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ _id: bookingId, ownerId, status: 'completed' });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Completed booking not found.' });
    }
    if (booking.reviewSubmittedAt) {
      return res.status(409).json({ success: false, message: 'Customer already submitted a review.' });
    }

    const owner = await User.findById(ownerId).select('businessName fullName');
    const businessName = owner?.businessName || owner?.fullName || 'Your service provider';

    // Generate a secure one-time token
    const token = (await import('crypto')).randomBytes(32).toString('hex');
    booking.reviewToken       = token;
    booking.reviewInviteSentAt = new Date();
    await booking.save();

    const reviewLink = `${process.env.CLIENT_URL || 'https://bookiify.vercel.app'}/review/${token}`;
    const eBusiness = escHtml(businessName);

    await sendEmail({
      to: booking.customerEmail,
      subject: `Comment s'est passé votre visite chez ${businessName} ? ⭐`,
      html: `
        <!DOCTYPE html><html><head>
        <style>
          body{margin:0;padding:0;background:#f1f5f9;font-family:'Segoe UI',Arial,sans-serif}
          .wrap{max-width:540px;margin:40px auto;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0}
          .header{background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 100%);padding:36px 40px;text-align:center}
          .stars{font-size:28px;letter-spacing:4px;margin-bottom:12px}
          .h1{color:#fff;margin:0;font-size:26px;font-weight:900;letter-spacing:-0.5px}
          .sub{color:rgba(255,255,255,0.75);font-size:14px;margin:8px 0 0}
          .body{padding:36px 40px}
          .card{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px 24px;margin:24px 0;text-align:center}
          .svc{color:#1e293b;font-weight:800;font-size:16px;margin:0 0 4px}
          .at{color:#94a3b8;font-size:13px;margin:0}
          .btn{display:block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff!important;text-decoration:none;font-weight:800;font-size:15px;padding:18px 32px;border-radius:16px;text-align:center;margin:28px 0;box-shadow:0 8px 24px -4px rgba(79,70,229,0.4)}
          .note{color:#94a3b8;font-size:12px;text-align:center;line-height:1.6}
          .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;font-size:11px;color:#94a3b8;text-align:center}
        </style></head><body>
        <div class="wrap">
          <div class="header">
            <div class="stars">⭐⭐⭐⭐⭐</div>
            <h1 class="h1">Partagez votre avis</h1>
            <p class="sub">Votre retour aide ${eBusiness} à s'améliorer</p>
          </div>
          <div class="body">
            <p style="color:#475569;font-size:15px;line-height:1.7;margin:0 0 16px">
              Bonjour <strong>${escHtml(booking.customerName)}</strong>,
            </p>
            <p style="color:#475569;font-size:14px;line-height:1.7;margin:0">
              Merci pour votre rendez-vous du <strong>${escHtml(booking.dateString)}</strong>.
              Votre avis compte — il aide d'autres clients à faire le bon choix et aide ${eBusiness} à grandir.
            </p>
            <div class="card">
              <p class="svc">${escHtml(booking.service?.title || 'Votre rendez-vous')}</p>
              <p class="at">chez ${eBusiness}</p>
            </div>
            <a href="${reviewLink}" class="btn">✍️ Laisser mon avis maintenant</a>
            <p class="note">Ce lien est personnel et à usage unique. Il expirera une fois votre avis soumis.</p>
          </div>
          <div class="footer">
            Envoyé par ${eBusiness} via Bookiify &mdash; Plateforme de réservation professionnelle en Tunisie
          </div>
        </div>
        </body></html>
      `,
    });

    res.status(200).json({ success: true, message: 'Review request sent.' });
  } catch (err) {
    console.error('[REVIEW_REQUEST_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to send review request.' });
  }
};

/* ─────────────────────────────────────────────────────────────────────────────
   STAFF PORTAL — BOOKING FUNCTIONS
   All functions scope to req.staff.ownerId (set by staffProtect middleware).
   ───────────────────────────────────────────────────────────────────────────── */

export const staffGetServices = async (req, res) => {
  try {
    const ownerId = req.staff.ownerId;
    const website = await Website.findOne({ ownerId });
    if (!website) return res.status(404).json({ success: false, message: 'Business website not found.' });
    res.json({
      success: true,
      data: {
        services: website.services.filter(s => s.active !== false),
        businessHours: website.businessHours,
        setupConfig: website.setupConfig,
      },
    });
  } catch (err) {
    console.error('[STAFF_SERVICES_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to load services.' });
  }
};

export const staffGetSlots = async (req, res) => {
  try {
    const ownerId = req.staff.ownerId;
    const { date, duration } = req.query;
    if (!date) return res.status(400).json({ success: false, message: 'Date is required.' });

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const requestedDate = new Date(date); requestedDate.setHours(0, 0, 0, 0);
    if (requestedDate < today) return res.status(400).json({ success: false, message: 'Cannot book in the past.' });

    const website = await Website.findOne({ ownerId });
    if (!website) return res.status(404).json({ success: false, message: 'Business not found.' });

    const dayConfig = resolveHoursForDate(website, date);
    if (!dayConfig || dayConfig.isClosed) {
      return res.json({ success: true, data: { date, isClosed: true, slots: [] } });
    }

    const serviceDuration = parseInt(duration) || 30;
    const setupConfig = website.setupConfig || {};
    const restMinutes = Math.max(0, parseInt(setupConfig.restMinutesBetweenConsultations) || 0);
    const maxCustomersPerDay = Math.max(1, parseInt(setupConfig.maxCustomersPerDay) || 25);
    const pauseWindows = (setupConfig.pauseWindows || []).filter(p => p?.start && p?.end && p.start < p.end);
    const serviceBufferMap = buildServiceBufferMap(website);
    const allSlots = generateTimeSlots(dayConfig.open, dayConfig.close, serviceDuration);

    const bookedSlots = await Booking.find({
      ownerId, dateString: date, status: { $in: ['pending', 'confirmed'] },
    }).select('timeSlot service.duration service.title');

    const isFullyBooked = bookedSlots.length >= maxCustomersPerDay;

    const slots = allSlots.map(time => {
      const cStart = toMinutes(time);
      const cEnd = cStart + serviceDuration;
      if (isInPauseWindow({ candidateStart: cStart, candidateEnd: cEnd, pauseWindows })) return { time, available: false };
      const hasConflict = bookedSlots.some(b => {
        const eBuf = Math.max(restMinutes, serviceBufferMap[b.service?.title] || 0);
        return hasIntervalConflict({ candidateStart: cStart, candidateEnd: cEnd, existingStart: toMinutes(b.timeSlot), existingDuration: parseInt(b?.service?.duration) || 30, restMinutes: eBuf });
      });
      return { time, available: !isFullyBooked && !hasConflict };
    });

    res.json({ success: true, data: { date, isClosed: false, open: dayConfig.open, close: dayConfig.close, slots } });
  } catch (err) {
    console.error('[STAFF_SLOTS_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to load slots.' });
  }
};

export const staffListBookings = async (req, res) => {
  try {
    const ownerId = req.staff.ownerId;
    const { date } = req.query;
    const query = { ownerId };
    if (date) query.dateString = date;
    const bookings = await Booking.find(query)
      .sort({ dateString: 1, timeSlot: 1 })
      .select('customerName customerPhone customerEmail service dateString timeSlot status notes createdAt');
    res.json({ success: true, data: bookings });
  } catch (err) {
    console.error('[STAFF_LIST_BOOKINGS_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to load bookings.' });
  }
};

export const staffCreateWalkin = async (req, res) => {
  try {
    const ownerId = req.staff.ownerId;
    const { customerName, customerEmail, customerPhone, service, date, timeSlot, notes } = req.body;

    if (!customerName || !customerPhone || !service || !date || !timeSlot) {
      return res.status(400).json({ success: false, message: 'Name, phone, service, date and time are required.' });
    }

    const today = new Date(); today.setHours(0, 0, 0, 0);
    const bookingDate = new Date(date); bookingDate.setHours(0, 0, 0, 0);
    if (bookingDate < today) return res.status(400).json({ success: false, message: 'Cannot book in the past.' });

    const conflict = await Booking.findOne({ ownerId, dateString: date, timeSlot, status: { $in: ['pending', 'confirmed'] } });
    if (conflict) return res.status(409).json({ success: false, message: 'This time slot is already taken.', code: 'SLOT_CONFLICT' });

    const website = await Website.findOne({ ownerId });
    const setupConfig = website?.setupConfig || {};
    const restMinutes = Math.max(0, parseInt(setupConfig.restMinutesBetweenConsultations) || 0);
    const maxCustomersPerDay = Math.max(1, parseInt(setupConfig.maxCustomersPerDay) || 25);
    const pauseWindows = (setupConfig.pauseWindows || []).filter(p => p?.start && p?.end && p.start < p.end);
    const serviceBufferMap = buildServiceBufferMap(website);
    const dayConfig = resolveHoursForDate(website, date);

    if (!dayConfig || dayConfig.isClosed) {
      return res.status(400).json({ success: false, message: 'Business is closed on the selected date.' });
    }

    const serviceDuration = parseInt(service?.duration) || 30;
    const candidateStart = toMinutes(timeSlot);
    const candidateEnd = candidateStart + serviceDuration;

    if (isInPauseWindow({ candidateStart, candidateEnd, pauseWindows })) {
      return res.status(400).json({ success: false, message: 'Selected time falls inside a pause window.' });
    }

    const activeBookings = await Booking.find({ ownerId, dateString: date, status: { $in: ['pending', 'confirmed'] } })
      .select('timeSlot service.duration service.title');

    if (activeBookings.length >= maxCustomersPerDay) {
      return res.status(409).json({ success: false, message: 'Maximum customers reached for this day.', code: 'DAILY_LIMIT_REACHED' });
    }

    const overlaps = activeBookings.some(b => {
      const eBuf = Math.max(restMinutes, serviceBufferMap[b.service?.title] || 0);
      return hasIntervalConflict({ candidateStart, candidateEnd, existingStart: toMinutes(b.timeSlot), existingDuration: parseInt(b?.service?.duration) || 30, restMinutes: eBuf });
    });
    if (overlaps) return res.status(409).json({ success: false, message: 'This slot conflicts with another appointment.', code: 'SLOT_CONFLICT' });

    const resolvedEmail = customerEmail?.trim()
      ? customerEmail.toLowerCase().trim()
      : `walkin-${Date.now()}@walkin.internal`;

    const booking = await Booking.create({
      ownerId,
      merchantId: ownerId,
      customerName: customerName.trim(),
      customerEmail: resolvedEmail,
      customerPhone: customerPhone.trim(),
      service: { title: service.title, price: service.price || 'N/A', duration: serviceDuration },
      appointmentDate: new Date(`${date}T${timeSlot}:00`),
      dateString: date,
      timeSlot,
      dayOfWeek: getDayName(date),
      notes: notes?.trim() || '',
      status: 'confirmed',
    });

    res.status(201).json({ success: true, data: booking, message: 'Walk-in booking created.' });
  } catch (err) {
    console.error('[STAFF_WALKIN_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to create walk-in booking.' });
  }
};

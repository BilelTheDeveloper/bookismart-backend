import Booking from '../models/Booking.js';
import Consultation from '../models/Consultation.js';

const ACTIVE_STATUSES = ['waiting', 'in_progress'];

const toSafeNumber = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const startConsultationFromBooking = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { bookingId } = req.params;

    const booking = await Booking.findOne({ _id: bookingId, ownerId });
    if (!booking) {
      return res.status(404).json({ success: false, message: 'Booking not found.' });
    }

    const durationMinutes = Math.max(5, toSafeNumber(booking?.service?.duration, 30));
    const initialSeconds = durationMinutes * 60;

    const consultation = await Consultation.findOneAndUpdate(
      { bookingId: booking._id },
      {
        ownerId,
        bookingId: booking._id,
        customerName: booking.customerName,
        customerEmail: booking.customerEmail,
        customerPhone: booking.customerPhone,
        serviceTitle: booking?.service?.title || 'Service',
        servicePrice: booking?.service?.price || '',
        serviceDurationMinutes: durationMinutes,
        dateString: booking.dateString,
        timeSlot: booking.timeSlot,
        status: 'in_progress',
        initialSeconds,
        remainingSeconds: initialSeconds,
        startedAt: new Date(),
        endedAt: null,
        lastActivityAt: new Date(),
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    if (booking.status === 'pending') {
      booking.status = 'confirmed';
      await booking.save();
    }

    return res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    console.error(`[CONSULTATION_START_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to start consultation.' });
  }
};

export const getOwnerConsultations = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const status = req.query.status || 'active';
    const filter = { ownerId };
    if (status === 'active') filter.status = { $in: ACTIVE_STATUSES };
    else if (status !== 'all') filter.status = status;

    const data = await Consultation.find(filter).sort({ updatedAt: -1 }).limit(80);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`[CONSULTATION_OWNER_LIST_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to load consultations.' });
  }
};

const emitConsultationEvent = (req, consultationId, event, payload) => {
  try {
    const io = req.app?.get?.('io');
    if (!io) return;
    io.to(`consultation:${consultationId}`).emit(event, payload);
  } catch {
    // no-op: sockets are best-effort
  }
};

export const updateConsultationTimer = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { consultationId } = req.params;
    const { action, seconds } = req.body;

    const consultation = await Consultation.findOne({ _id: consultationId, ownerId });
    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }
    if (consultation.status === 'done') {
      return res.status(400).json({ success: false, message: 'Consultation already completed.' });
    }

    const delta = Math.max(0, toSafeNumber(seconds, 0));
    if (action === 'add') consultation.remainingSeconds += delta;
    else if (action === 'subtract') consultation.remainingSeconds = Math.max(0, consultation.remainingSeconds - delta);
    else if (action === 'set') consultation.remainingSeconds = Math.max(0, delta);
    else {
      return res.status(400).json({ success: false, message: 'Invalid timer action.' });
    }

    consultation.lastActivityAt = new Date();
    await consultation.save();
    return res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    console.error(`[CONSULTATION_TIMER_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to update timer.' });
  }
};

export const addConsultationMessage = async (req, res) => {
  try {
    const user = req.user;
    const { consultationId } = req.params;
    const { text } = req.body;
    if (!text || !text.trim()) {
      return res.status(400).json({ success: false, message: 'Message text is required.' });
    }

    const consultation = await Consultation.findById(consultationId);
    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    const isOwner = user.role === 'owner' && String(consultation.ownerId) === String(user._id);
    // Work Mode: allow owner to send as 'worker' via trusted UI header
    const workModeRole = String(req.headers['x-work-mode-role'] || '').toLowerCase();
    const isWorkerMode = isOwner && workModeRole === 'worker';

    const isAdmin = user.role === 'admin';
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ success: false, message: 'Not allowed for this consultation.' });
    }

    consultation.messages.push({
      senderRole: isWorkerMode ? 'worker' : (isOwner ? 'owner' : 'worker'),
      senderId: user._id,
      text: text.trim(),
    });
    consultation.lastActivityAt = new Date();
    await consultation.save();

    emitConsultationEvent(req, consultation._id, 'consultation:message', {
      consultationId: String(consultation._id),
      message: consultation.messages[consultation.messages.length - 1],
    });

    return res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    console.error(`[CONSULTATION_MESSAGE_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to send message.' });
  }
};

export const completeConsultation = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { consultationId } = req.params;
    const { ownerNotes, completionSummary } = req.body;

    const consultation = await Consultation.findOne({ _id: consultationId, ownerId });
    if (!consultation) {
      return res.status(404).json({ success: false, message: 'Consultation not found.' });
    }

    consultation.status = 'done';
    consultation.ownerNotes = (ownerNotes || '').trim();
    consultation.completionSummary = (completionSummary || '').trim();
    consultation.endedAt = new Date();
    consultation.lastActivityAt = new Date();
    await consultation.save();

    await Booking.findByIdAndUpdate(consultation.bookingId, { status: 'completed', notes: consultation.ownerNotes || '' });

    emitConsultationEvent(req, consultation._id, 'consultation:done', {
      consultationId: String(consultation._id),
      ownerNotes: consultation.ownerNotes,
      endedAt: consultation.endedAt,
    });

    return res.status(200).json({ success: true, data: consultation });
  } catch (error) {
    console.error(`[CONSULTATION_COMPLETE_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to complete consultation.' });
  }
};

export const getCustomerConsultationHistory = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { customerEmail, customerPhone } = req.query;
    if (!customerEmail && !customerPhone) {
      return res.status(400).json({ success: false, message: 'customerEmail or customerPhone is required.' });
    }

    const filter = { ownerId, status: 'done' };
    if (customerEmail) filter.customerEmail = String(customerEmail).toLowerCase().trim();
    if (customerPhone) filter.customerPhone = String(customerPhone).trim();

    const data = await Consultation.find(filter).sort({ endedAt: -1 }).limit(20);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`[CONSULTATION_HISTORY_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to load customer history.' });
  }
};

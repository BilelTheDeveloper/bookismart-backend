import cron from 'node-cron';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { sendEmail } from './emailService.js';
import { sendSms, sendWhatsApp } from './messageProviders.js';

const hours = (n) => n * 60 * 60 * 1000;

const withinWindow = (targetMs, windowMs = 5 * 60 * 1000) => {
  const now = Date.now();
  return Math.abs(targetMs - now) <= windowMs;
};

const buildReminderText = (booking, ownerName) => {
  return `Reminder: ${booking.service?.title} with ${ownerName} on ${booking.dateString} at ${booking.timeSlot}.`;
};

export const runRemindersOnce = async () => {
  // Only remind confirmed bookings (you can change later)
  const candidates = await Booking.find({
    status: 'confirmed',
    appointmentDate: { $gte: new Date(Date.now() - hours(1)), $lte: new Date(Date.now() + hours(48)) },
  }).limit(500);

  for (const b of candidates) {
    const apptMs = new Date(b.appointmentDate).getTime();
    const owner = await User.findById(b.ownerId).select('businessName fullName');
    const ownerName = owner?.businessName || owner?.fullName || 'Bookiify Pro';

    const needs24h = !b.reminder24hSentAt && withinWindow(apptMs - hours(24));
    const needs2h = !b.reminder2hSentAt && withinWindow(apptMs - hours(2));
    if (!needs24h && !needs2h) continue;

    const subject = needs24h
      ? `Reminder: your appointment tomorrow at ${b.timeSlot}`
      : `Reminder: your appointment in 2 hours (${b.timeSlot})`;

    const text = buildReminderText(b, ownerName);
    const html = `
      <div style="font-family:Segoe UI,Arial;max-width:600px;margin:auto;border:1px solid #eef2f7;padding:24px;border-radius:16px;">
        <h2 style="margin:0 0 12px;color:#0f172a;">Appointment reminder</h2>
        <p style="margin:0 0 10px;color:#334155;"><strong>${ownerName}</strong></p>
        <p style="margin:0 0 6px;color:#334155;">${b.service?.title}</p>
        <p style="margin:0;color:#64748b;">${b.dateString} at ${b.timeSlot}</p>
      </div>
    `;

    try {
      // Email always first (works now)
      await sendEmail({ to: b.customerEmail, subject, html, text });
      // SMS/WhatsApp are optional stubs until provider keys are added
      await sendSms({ to: b.customerPhone, text });
      await sendWhatsApp({ to: b.customerPhone, text });

      if (needs24h) b.reminder24hSentAt = new Date();
      if (needs2h) b.reminder2hSentAt = new Date();
      b.reminderLastError = '';
      await b.save();
    } catch (e) {
      b.reminderLastError = String(e?.message || e);
      await b.save();
    }
  }
};

export const startReminderScheduler = () => {
  if (process.env.ENABLE_REMINDERS !== 'true') return;
  cron.schedule('*/1 * * * *', () => {
    runRemindersOnce().catch((err) => {
      console.error('[REMINDER_SCHEDULER_ERROR]', err.message);
    });
  });
};


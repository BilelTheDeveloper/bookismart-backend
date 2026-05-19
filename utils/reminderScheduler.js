import cron from 'node-cron';
import Booking from '../models/Booking.js';
import User from '../models/User.js';
import { sendEmail } from './emailService.js';
import { sendSms, sendWhatsApp24hReminder, sendWhatsApp2hReminder } from './messageProviders.js';

const hours = (n) => n * 60 * 60 * 1000;

const withinWindow = (targetMs, windowMs = 5 * 60 * 1000) => {
  const now = Date.now();
  return Math.abs(targetMs - now) <= windowMs;
};

export const runRemindersOnce = async () => {
  const candidates = await Booking.find({
    status: 'confirmed',
    appointmentDate: {
      $gte: new Date(Date.now() - hours(1)),
      $lte: new Date(Date.now() + hours(48)),
    },
  }).limit(500);

  for (const b of candidates) {
    const apptMs = new Date(b.appointmentDate).getTime();
    const owner = await User.findById(b.ownerId).select('businessName fullName');
    const ownerName = owner?.businessName || owner?.fullName || 'Bookiify Pro';

    const needs24h = !b.reminder24hSentAt && withinWindow(apptMs - hours(24));
    const needs2h  = !b.reminder2hSentAt  && withinWindow(apptMs - hours(2));
    if (!needs24h && !needs2h) continue;

    const subject = needs24h
      ? `Rappel : votre rendez-vous demain à ${b.timeSlot}`
      : `Rappel : votre rendez-vous dans 2 heures (${b.timeSlot})`;

    const emailHtml = `
      <div style="font-family:Segoe UI,Arial;max-width:600px;margin:auto;border:1px solid #eef2f7;padding:24px;border-radius:16px;">
        <h2 style="margin:0 0 12px;color:#0f172a;">Rappel de rendez-vous</h2>
        <p style="margin:0 0 10px;color:#334155;"><strong>${ownerName}</strong></p>
        <p style="margin:0 0 6px;color:#334155;">${b.service?.title}</p>
        <p style="margin:0;color:#64748b;">${b.dateString} à ${b.timeSlot}</p>
      </div>
    `;
    const emailText = `Rappel : ${b.service?.title} avec ${ownerName} — ${b.dateString} à ${b.timeSlot}`;

    try {
      await sendEmail({ to: b.customerEmail, subject, html: emailHtml, text: emailText });

      if (needs24h) {
        await sendWhatsApp24hReminder({
          to: b.customerPhone,
          customerName: b.customerName,
          businessName: ownerName,
          service: b.service?.title,
          dateString: b.dateString,
          timeSlot: b.timeSlot,
          cancelToken: b.reviewToken || null,
          baseUrl: process.env.CLIENT_URL,
        });
        await sendSms({ to: b.customerPhone, text: emailText });
        b.reminder24hSentAt = new Date();
      }

      if (needs2h) {
        await sendWhatsApp2hReminder({
          to: b.customerPhone,
          customerName: b.customerName,
          businessName: ownerName,
          service: b.service?.title,
          timeSlot: b.timeSlot,
        });
        await sendSms({ to: b.customerPhone, text: emailText });
        b.reminder2hSentAt = new Date();
      }

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

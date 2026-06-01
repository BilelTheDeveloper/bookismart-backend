import Booking from '../models/Booking.js';
import User from '../models/User.js';
import Campaign from '../models/Campaign.js';
import { sendWhatsApp } from '../utils/messageProviders.js';
import { sendEmail } from '../utils/emailService.js';

const BROADCAST_CAP = 200; // safety cap per broadcast

/* Build the unique-customer list for a segment from this owner's bookings. */
async function getRecipients(ownerId, segment) {
  const rows = await Booking.aggregate([
    { $match: { ownerId, customerEmail: { $ne: '' } } },
    { $group: {
      _id: { $toLower: '$customerEmail' },
      name: { $first: '$customerName' },
      phone: { $first: '$customerPhone' },
      last: { $max: '$appointmentDate' },
    } },
  ]);

  const now = Date.now();
  const inactiveCut = now - 45 * 86400000;
  const recentCut = now - 30 * 86400000;

  let list = rows.map((r) => ({ email: r._id, name: r.name || '', phone: r.phone || '', last: r.last ? new Date(r.last).getTime() : 0 }));
  if (segment === 'inactive') list = list.filter((r) => !r.last || r.last < inactiveCut);
  else if (segment === 'recent') list = list.filter((r) => r.last && r.last >= recentCut);
  return list;
}

// GET /api/merchant/marketing/audience — counts per segment + channel status
export const getAudience = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const [all, inactive, recent] = await Promise.all([
      getRecipients(ownerId, 'all'),
      getRecipients(ownerId, 'inactive'),
      getRecipients(ownerId, 'recent'),
    ]);
    res.json({
      success: true,
      segments: {
        all: all.length,
        inactive: inactive.length,
        recent: recent.length,
      },
      channels: {
        whatsapp: process.env.WHATSAPP_ENABLED === 'true',
        email: true,
        sms: process.env.SMS_ENABLED === 'true',
      },
    });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not load audience.' }); }
};

// GET /api/merchant/marketing/campaigns — history
export const getCampaigns = async (req, res) => {
  try {
    const campaigns = await Campaign.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).limit(30);
    res.json({ success: true, campaigns });
  } catch (e) { res.status(500).json({ success: false, message: 'Could not load campaigns.' }); }
};

// POST /api/merchant/marketing/broadcast  { segment, subject, message, channels:{whatsapp,email} }
export const sendBroadcast = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { segment = 'all', subject = '', message = '', channels = {} } = req.body;
    if (!message?.trim()) return res.status(400).json({ success: false, message: 'Message is required.' });
    if (!['all', 'inactive', 'recent'].includes(segment)) return res.status(400).json({ success: false, message: 'Invalid segment.' });

    const owner = await User.findById(ownerId).select('businessName fullName');
    const businessName = owner?.businessName || owner?.fullName || 'Bookiify';

    let recipients = await getRecipients(ownerId, segment);
    const total = recipients.length;
    recipients = recipients.slice(0, BROADCAST_CAP);

    const useWa = channels.whatsapp === true && process.env.WHATSAPP_ENABLED === 'true';
    const useEmail = channels.email !== false; // email on by default

    const personalize = (text, name) => text.replace(/\{name\}/gi, name || 'there');

    let sentWhatsApp = 0;
    let sentEmail = 0;

    await Promise.allSettled(
      recipients.map(async (r) => {
        const body = personalize(message, r.name);
        if (useWa && r.phone) {
          const wa = await sendWhatsApp({ to: r.phone, text: `*${businessName}*\n\n${body}\n\n_Bookiify_` });
          if (wa?.success && !wa?.skipped) sentWhatsApp++;
        }
        if (useEmail && r.email) {
          try {
            await sendEmail({
              to: r.email,
              subject: subject || `A message from ${businessName}`,
              html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:auto;padding:24px"><h2 style="font-weight:800">${businessName}</h2><p style="font-size:15px;line-height:1.6;color:#334155;white-space:pre-line">${body}</p><p style="font-size:12px;color:#94a3b8;margin-top:24px">Sent via Bookiify</p></div>`,
              text: body,
            });
            sentEmail++;
          } catch { /* skip individual failures */ }
        }
      })
    );

    const campaign = await Campaign.create({
      ownerId, segment, subject, message: message.slice(0, 1000),
      channels: { whatsapp: useWa, email: useEmail },
      recipientCount: recipients.length, sentWhatsApp, sentEmail,
    });

    res.json({ success: true, campaign, total, sent: recipients.length, sentWhatsApp, sentEmail, capped: total > BROADCAST_CAP });
  } catch (e) {
    console.error('[BROADCAST]', e.message);
    res.status(500).json({ success: false, message: 'Broadcast failed.' });
  }
};

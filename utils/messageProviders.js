/**
 * MESSAGE PROVIDERS
 *
 * All channels are OFF by default. Set the feature flag env vars to enable them:
 *
 *   WHATSAPP_ENABLED=true          — enable WhatsApp Cloud API
 *   WHATSAPP_API_TOKEN=...         — Meta permanent access token
 *   WHATSAPP_PHONE_ID=...          — WhatsApp Business phone number ID
 *
 *   SMS_ENABLED=true               — enable SMS (future: Twilio or local gateway)
 *   SMS_PROVIDER=twilio            — 'twilio' | 'vonage' | 'local'
 *   TWILIO_SID=...
 *   TWILIO_AUTH=...
 *   TWILIO_FROM=...
 */

import https from 'https';

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a Tunisian phone number to E.164 (+216XXXXXXXX).
 * Accepts: "0021699...", "+21699...", "99...", "21699..."
 */
const toE164Tunisia = (raw = '') => {
  const digits = String(raw).replace(/\D/g, '');
  if (digits.startsWith('216'))  return `+${digits}`;
  if (digits.startsWith('0216')) return `+${digits.slice(1)}`;
  if (digits.length === 8)       return `+216${digits}`;
  // Already has country code or unknown — pass through with +
  return digits.startsWith('+') ? raw : `+${digits}`;
};

/**
 * Minimal HTTPS POST helper — no external deps, returns parsed JSON.
 */
const httpsPost = (url, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const { hostname, pathname, search } = new URL(url);
    const options = {
      hostname,
      path: pathname + (search || ''),
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
        ...headers,
      },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, status: res.statusCode, data: parsed });
          } else {
            resolve({ ok: false, status: res.statusCode, data: parsed });
          }
        } catch {
          resolve({ ok: false, status: res.statusCode, data });
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(new Error('WhatsApp API timeout')); });
    req.write(payload);
    req.end();
  });

// ─────────────────────────────────────────────────────────────────────────────
// WHATSAPP BUSINESS CLOUD API (Meta Graph API v19)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Low-level send — text message via Meta Cloud API.
 * In production you can switch to template messages by passing type='template'.
 */
const whatsappSendText = async (to, body) => {
  const phoneId = process.env.WHATSAPP_PHONE_ID;
  const token   = process.env.WHATSAPP_API_TOKEN;

  const url = `https://graph.facebook.com/v19.0/${phoneId}/messages`;
  const payload = {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'text',
    text: { preview_url: false, body },
  };

  const result = await httpsPost(url, payload, { Authorization: `Bearer ${token}` });

  if (!result.ok) {
    const errMsg = result.data?.error?.message || JSON.stringify(result.data);
    throw new Error(`WhatsApp API error ${result.status}: ${errMsg}`);
  }

  return result.data;
};

// ─────────────────────────────────────────────────────────────────────────────
// HIGH-LEVEL MESSAGE BUILDERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sent immediately when an owner confirms a booking.
 */
export const sendWhatsAppConfirmation = async ({ to, customerName, businessName, service, dateString, timeSlot, price }) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return { success: true, skipped: true };
  const phone = toE164Tunisia(to);
  const text = [
    `✅ *Rendez-vous confirmé !*`,
    ``,
    `Bonjour ${customerName} !`,
    `Votre rendez-vous a été confirmé.`,
    ``,
    `📍 *${businessName}*`,
    `✂️  ${service}`,
    `📅 ${dateString} à ${timeSlot}`,
    price ? `💰 ${price} TND` : '',
    ``,
    `À très bientôt !`,
    `_Bookiify_`,
  ].filter((l) => l !== undefined).join('\n');

  try {
    await whatsappSendText(phone, text);
    return { success: true };
  } catch (err) {
    console.error('[WHATSAPP_CONFIRM_ERROR]', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * 24-hour reminder with cancel link.
 */
export const sendWhatsApp24hReminder = async ({ to, customerName, businessName, service, dateString, timeSlot, cancelToken, baseUrl }) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return { success: true, skipped: true };
  const phone = toE164Tunisia(to);
  const cancelLink = cancelToken ? `${baseUrl || 'https://bookiify.vercel.app'}/cancel/${cancelToken}` : null;

  const text = [
    `🗓️ *Rappel — Demain !*`,
    ``,
    `Bonjour ${customerName},`,
    `Vous avez un rendez-vous demain.`,
    ``,
    `📍 *${businessName}*`,
    `✂️  ${service}`,
    `📅 ${dateString} à ${timeSlot}`,
    ``,
    cancelLink ? `❌ Annuler : ${cancelLink}` : '',
    ``,
    `_Bookiify — Ne ratez plus jamais un rendez-vous._`,
  ].filter((l) => l !== undefined).join('\n');

  try {
    await whatsappSendText(phone, text);
    return { success: true };
  } catch (err) {
    console.error('[WHATSAPP_24H_ERROR]', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * 2-hour reminder — urgent tone.
 */
export const sendWhatsApp2hReminder = async ({ to, customerName, businessName, service, timeSlot }) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return { success: true, skipped: true };
  const phone = toE164Tunisia(to);

  const text = [
    `⏰ *Dans 2 heures !*`,
    ``,
    `Bonjour ${customerName},`,
    `Votre rendez-vous est très bientôt !`,
    ``,
    `📍 *${businessName}*`,
    `✂️  ${service}`,
    `🕐 Aujourd'hui à ${timeSlot}`,
    ``,
    `En retard ? Prévenez votre prestataire dès que possible.`,
    ``,
    `_Bookiify_`,
  ].join('\n');

  try {
    await whatsappSendText(phone, text);
    return { success: true };
  } catch (err) {
    console.error('[WHATSAPP_2H_ERROR]', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Cancellation notification sent to the customer.
 */
export const sendWhatsAppCancellation = async ({ to, customerName, businessName, service, dateString, timeSlot, reason }) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return { success: true, skipped: true };
  const phone = toE164Tunisia(to);

  const text = [
    `❌ *Rendez-vous annulé*`,
    ``,
    `Bonjour ${customerName},`,
    `Votre rendez-vous a été annulé.`,
    ``,
    `📍 *${businessName}*`,
    `✂️  ${service}`,
    `📅 ${dateString} à ${timeSlot}`,
    reason ? `\n📝 Motif : ${reason}` : '',
    ``,
    `Vous pouvez reprendre un nouveau rendez-vous quand vous le souhaitez.`,
    ``,
    `_Bookiify_`,
  ].filter((l) => l !== undefined).join('\n');

  try {
    await whatsappSendText(phone, text);
    return { success: true };
  } catch (err) {
    console.error('[WHATSAPP_CANCEL_ERROR]', err.message);
    return { success: false, error: err.message };
  }
};

/**
 * Generic WhatsApp sender — used by reminderScheduler for the stub calls.
 * This is the drop-in replacement for the old sendWhatsApp({ to, text }) call.
 */
export const sendWhatsApp = async ({ to, text }) => {
  if (process.env.WHATSAPP_ENABLED !== 'true') return { success: true, skipped: true };
  const phone = toE164Tunisia(to);
  try {
    await whatsappSendText(phone, text);
    return { success: true };
  } catch (err) {
    console.error('[WHATSAPP_GENERIC_ERROR]', err.message);
    return { success: false, error: err.message };
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SMS — stub until provider keys are added
// ─────────────────────────────────────────────────────────────────────────────
export const sendSms = async ({ to, text }) => {
  if (process.env.SMS_ENABLED !== 'true') return { success: true, skipped: true };
  // TODO: wire Twilio or local Tunisian gateway (InTouch, Flouci, etc.)
  console.warn('[SMS] Provider not wired yet. Set SMS_ENABLED=true + provider config.');
  return { success: false, error: 'SMS provider not configured' };
};

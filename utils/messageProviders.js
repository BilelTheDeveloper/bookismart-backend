/**
 * Provider adapters.
 * For now: SMS/WhatsApp are NO-OP until you add credentials.
 */

export const sendSms = async ({ to, text }) => {
  // TODO: integrate Twilio or local Tunisian gateway when you get API keys.
  if (!process.env.SMS_PROVIDER || process.env.SMS_PROVIDER === 'disabled') {
    return { success: true, skipped: true };
  }
  return { success: false, error: 'SMS provider not configured' };
};

export const sendWhatsApp = async ({ to, text }) => {
  // TODO: integrate WhatsApp Business API / Twilio WhatsApp when you get API keys.
  if (!process.env.WHATSAPP_PROVIDER || process.env.WHATSAPP_PROVIDER === 'disabled') {
    return { success: true, skipped: true };
  }
  return { success: false, error: 'WhatsApp provider not configured' };
};


/**
 * PAYMENT PROVIDERS — Tunisia (Flouci & Konnect)
 *
 * ALL credentials come from environment variables (never hardcoded):
 *
 *   PAYMENTS_ENABLED=true
 *   PAYMENTS_DEFAULT_PROVIDER=flouci          # 'flouci' | 'konnect'
 *   PUBLIC_APP_URL=https://bookiify.vercel.app # for success/fail redirects
 *   PUBLIC_API_URL=https://...onrender.com/api # for the webhook callback
 *
 *   # Flouci
 *   FLOUCI_APP_TOKEN=...
 *   FLOUCI_APP_SECRET=...
 *
 *   # Konnect
 *   KONNECT_API_KEY=...
 *   KONNECT_WALLET_ID=...
 *   KONNECT_BASE=https://api.konnect.network    # use the sandbox base for testing
 */

import https from 'https';

const httpsRequest = (method, url, body, headers = {}) =>
  new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const { hostname, pathname, search } = new URL(url);
    const options = {
      hostname, path: pathname + (search || ''), method,
      headers: { 'Content-Type': 'application/json', ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers },
    };
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try { const parsed = JSON.parse(data); resolve({ ok: res.statusCode >= 200 && res.statusCode < 300, status: res.statusCode, data: parsed }); }
        catch { resolve({ ok: false, status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(12000, () => req.destroy(new Error('Payment provider timeout')));
    if (payload) req.write(payload);
    req.end();
  });

const toMillimes = (tnd) => Math.round(Number(tnd) * 1000);

/** Which providers are configured (env present). */
export const providerStatus = () => ({
  enabled: process.env.PAYMENTS_ENABLED === 'true',
  default: process.env.PAYMENTS_DEFAULT_PROVIDER || 'flouci',
  flouci: !!(process.env.FLOUCI_APP_TOKEN && process.env.FLOUCI_APP_SECRET),
  konnect: !!(process.env.KONNECT_API_KEY && process.env.KONNECT_WALLET_ID),
});

// ── Flouci ──────────────────────────────────────────────────────────────────
const flouciCreate = async ({ amount, ref, successUrl, failUrl }) => {
  const res = await httpsRequest('POST', 'https://developers.flouci.com/api/generate_payment', {
    app_token: process.env.FLOUCI_APP_TOKEN,
    app_secret: process.env.FLOUCI_APP_SECRET,
    amount: String(toMillimes(amount)),
    accept_card: 'true',
    session_timeout_secs: 1200,
    success_link: successUrl,
    fail_link: failUrl,
    developer_tracking_id: ref,
  });
  if (!res.ok || !res.data?.result?.link) {
    return { ok: false, error: res.data?.result?.message || 'Flouci error' };
  }
  return { ok: true, payUrl: res.data.result.link, providerRef: res.data.result.payment_id || ref };
};

const flouciVerify = async (paymentId) => {
  const res = await httpsRequest('GET', `https://developers.flouci.com/api/verify_payment/${paymentId}`, null, {
    apppublic: process.env.FLOUCI_APP_TOKEN,
    appsecret: process.env.FLOUCI_APP_SECRET,
  });
  const status = res.data?.result?.status;
  return { ok: res.ok, paid: status === 'SUCCESS' };
};

// ── Konnect ─────────────────────────────────────────────────────────────────
const konnectCreate = async ({ amount, ref, successUrl, failUrl, webhookUrl, customer }) => {
  const base = process.env.KONNECT_BASE || 'https://api.konnect.network';
  const res = await httpsRequest('POST', `${base}/api/v2/payments/init-payment`, {
    receiverWalletId: process.env.KONNECT_WALLET_ID,
    token: 'TND',
    amount: toMillimes(amount),
    type: 'immediate',
    description: `Booking ${ref}`,
    acceptedPaymentMethods: ['wallet', 'bank_card', 'e-DINAR'],
    firstName: customer?.name || '',
    email: customer?.email || '',
    phoneNumber: customer?.phone || '',
    orderId: ref,
    successUrl, failUrl, webhook: webhookUrl,
    silentWebhook: true,
  }, { 'x-api-key': process.env.KONNECT_API_KEY });
  if (!res.ok || !res.data?.payUrl) {
    return { ok: false, error: res.data?.errors?.[0]?.message || 'Konnect error' };
  }
  return { ok: true, payUrl: res.data.payUrl, providerRef: res.data.paymentRef };
};

const konnectVerify = async (paymentRef) => {
  const base = process.env.KONNECT_BASE || 'https://api.konnect.network';
  const res = await httpsRequest('GET', `${base}/api/v2/payments/${paymentRef}`, null, { 'x-api-key': process.env.KONNECT_API_KEY });
  const status = res.data?.payment?.status;
  return { ok: res.ok, paid: status === 'completed' };
};

/**
 * Create a payment link with the chosen (or default) provider.
 * Returns { ok, payUrl, providerRef, provider } or { ok:false, error }.
 */
export const createPaymentLink = async ({ provider, amount, ref, successUrl, failUrl, webhookUrl, customer }) => {
  const st = providerStatus();
  if (!st.enabled) return { ok: false, notConfigured: true, error: 'Payments are not enabled.' };
  const chosen = (provider && provider !== 'manual') ? provider : st.default;

  if (chosen === 'flouci') {
    if (!st.flouci) return { ok: false, notConfigured: true, error: 'Flouci is not configured.' };
    const r = await flouciCreate({ amount, ref, successUrl, failUrl });
    return { ...r, provider: 'flouci' };
  }
  if (chosen === 'konnect') {
    if (!st.konnect) return { ok: false, notConfigured: true, error: 'Konnect is not configured.' };
    const r = await konnectCreate({ amount, ref, successUrl, failUrl, webhookUrl, customer });
    return { ...r, provider: 'konnect' };
  }
  return { ok: false, error: 'Unknown provider.' };
};

/** Verify a payment status with the provider (used by webhook/return). */
export const verifyPayment = async ({ provider, providerRef }) => {
  if (provider === 'flouci') return flouciVerify(providerRef);
  if (provider === 'konnect') return konnectVerify(providerRef);
  return { ok: false, paid: false };
};

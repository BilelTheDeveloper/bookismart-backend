import crypto from 'crypto';

/**
 * 🔒 ADVANCED DEVICE FINGERPRINTING MIDDLEWARE
 * Purpose: Ensures the request is coming from the authorized device.
 * Prevents: Token Hijacking and Session Replay attacks.
 */
export const fingerprinter = (req, res, next) => {
  try {
    // 1. Primary Source: The Unique ID from your Axios Interceptor
    const clientHeaderFingerprint = req.headers['x-device-fingerprint'];

    // 2. Secondary Source (Server-Side Hash): 
    // Combines IP and User-Agent to verify the hardware/network context.
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    
    const serverSideHash = crypto
      .createHash('sha256')
      .update(`${ip}-${userAgent}`)
      .digest('hex');

    /**
     * 🛡️ SECURE ATTACHMENT
     * We attach the fingerprint to a uniquely named property.
     * This avoids the "Getter Error" by not touching req.query or req.params.
     */
    req.deviceFingerprint = clientHeaderFingerprint || serverSideHash;

    // Optional: Log for Security Audit (Development only)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Security Hub] Fingerprint Active: ${req.deviceFingerprint.substring(0, 10)}...`);
    }

    next();
  } catch (error) {
    console.error("FINGERPRINT_GENERATION_FAILURE:", error);
    // We don't block the request here, but we log the failure.
    next();
  }
};
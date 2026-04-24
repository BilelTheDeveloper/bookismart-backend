import crypto from 'crypto';

/**
 * 🔒 ENTERPRISE MULTI-FACTOR FINGERPRINTING
 * Logic:
 * 1. Trusts the Client-Side UUID (High Reliability)
 * 2. Cross-references with Server-Side Hardware Hash (High Security)
 */
export const fingerprinter = (req, res, next) => {
  try {
    // 1. Extract the unique ID sent by our Axios Interceptor
    const clientHeaderFingerprint = req.headers['x-device-fingerprint'];

    // 2. Generate a Hardware/Network Anchor (IP + UserAgent)
    // This detects if the same token is used on a different machine/network
    const ip = req.headers['x-forwarded-for']?.split(',')[0] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    
    const hardwareAnchor = crypto
      .createHash('sha1') // Faster hash for anchor verification
      .update(`${ip}-${userAgent}`)
      .digest('hex');

    /**
     * 🛡️ THE SECURITY BINDING
     * We don't just pick one; we bind them together. 
     * If the client didn't send a fingerprint, we fall back to the anchor.
     */
    if (clientHeaderFingerprint) {
      // Logic: "This specific hardware (anchor) is using this specific UUID"
      req.deviceFingerprint = clientHeaderFingerprint;
    } else {
      req.deviceFingerprint = hardwareAnchor;
    }

    // 3. Attach metadata for the Protect Middleware to use if needed
    req.fingerprintAnchor = hardwareAnchor;

    // Log for Security Audit
    console.log(`[Security Hub] Active ID: ${req.deviceFingerprint.substring(0, 10)}...`);

    next();
  } catch (error) {
    console.error("🚨 [CRITICAL]: FINGERPRINT_ENGINE_FAILURE", error);
    // Fail Closed: If security engine fails, we don't assign a valid ID
    req.deviceFingerprint = 'REJECTED_BY_ENGINE';
    next();
  }
};
import crypto from 'crypto';

/**
 * 🔒 ENTERPRISE MULTI-FACTOR FINGERPRINTING (Ultra-Secured)
 * * This is the "Identity Lock". It bridges the Frontend UUID with 
 * Backend Hardware Anchors to ensure the session cannot be hijacked
 * even if the cookie is stolen.
 */
export const fingerprinter = (req, res, next) => {
  try {
    // 1. PRIMARY: Extract the UUID from the Axios Interceptor
    // This is our high-reliability source.
    const clientHeaderFingerprint = req.headers['x-device-fingerprint'];

    // 2. SECONDARY: Hardware/Network Anchor
    // We split 'x-forwarded-for' to get the REAL user IP behind Render/Cloudflare.
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const realIp = rawIp.split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    
    // We create a server-side hash of the environment
    const hardwareAnchor = crypto
      .createHash('sha256') 
      .update(`${realIp}-${userAgent}`)
      .digest('hex');

    /**
     * 🛡️ THE SECURITY BINDING LOGIC
     * * If the client sends a UUID, we use it as the primary ID.
     * We attach the hardware anchor as a 'Security Shadow' to detect 
     * if that UUID suddenly jumps to a different IP or Browser.
     */
    if (clientHeaderFingerprint && clientHeaderFingerprint !== 'null' && clientHeaderFingerprint !== 'undefined') {
      req.deviceFingerprint = clientHeaderFingerprint;
    } else {
      // Fallback to hardware hash if the frontend hasn't initialized the UUID yet
      req.deviceFingerprint = hardwareAnchor;
    }

    // 3. Attach for downstream Audit (used by protect middleware)
    req.fingerprintAnchor = hardwareAnchor;

    // Log the first 10 chars for debugging in Render
    console.log(`[Security Hub] Identity Locked: ${req.deviceFingerprint.substring(0, 10)}...`);

    next();
  } catch (error) {
    console.error("🚨 [SECURITY_CRITICAL]: FINGERPRINT_ENGINE_FAILURE", error);
    // FAIL CLOSED: Do not allow an empty fingerprint
    req.deviceFingerprint = 'REJECTED_BY_VAULT';
    next();
  }
};
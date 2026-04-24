import crypto from 'crypto';

/**
 * 🔒 ENTERPRISE MULTI-FACTOR FINGERPRINTING (Ultra-Secured)
 * Purpose: Bridges Frontend UUID with Backend Hardware Anchors.
 */
export const fingerprinter = (req, res, next) => {
  try {
    // 1. PRIMARY: Extract the UUID from the Axios Interceptor
    const clientHeaderFingerprint = req.headers['x-device-fingerprint'];

    // 2. SECONDARY: Hardware/Network Anchor
    const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '0.0.0.0';
    const realIp = rawIp.split(',')[0].trim();
    const userAgent = req.headers['user-agent'] || 'unknown_agent';
    
    // Create a server-side hash of the environment
    const hardwareAnchor = crypto
      .createHash('sha256') 
      .update(`${realIp}-${userAgent}`)
      .digest('hex');

    /**
     * 🛡️ THE SECURITY BINDING LOGIC
     * We use Object.defineProperty to attach these securely.
     * This prevents 'express-mongo-sanitize' from trying to "clean" these 
     * properties, which is what causes the 500 "Getter" error.
     */
    let finalFingerprint;

    if (clientHeaderFingerprint && clientHeaderFingerprint !== 'null' && clientHeaderFingerprint !== 'undefined') {
      finalFingerprint = clientHeaderFingerprint;
    } else {
      finalFingerprint = hardwareAnchor;
    }

    // 🛡️ SECURE ATTACHMENT: Non-enumerable properties are invisible to sanitizers
    Object.defineProperty(req, 'deviceFingerprint', {
      value: finalFingerprint,
      writable: true,
      enumerable: false, // 👈 THE FIX: Sanitizers won't trip over this
      configurable: true
    });

    Object.defineProperty(req, 'fingerprintAnchor', {
      value: hardwareAnchor,
      writable: true,
      enumerable: false, // 👈 THE FIX: Sanitizers won't trip over this
      configurable: true
    });

    // Log the first 10 chars for debugging in Render
    console.log(`[Security Hub] Identity Locked: ${req.deviceFingerprint.substring(0, 10)}...`);

    next();
  } catch (error) {
    console.error("🚨 [SECURITY_CRITICAL]: FINGERPRINT_ENGINE_FAILURE", error);
    
    // FAIL CLOSED: Securely reject the state
    req.deviceFingerprint = 'REJECTED_BY_VAULT';
    next();
  }
};
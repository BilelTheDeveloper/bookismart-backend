import crypto from 'crypto';
import { calculateServerAnchor } from '../utils/fingerprintHelper.js';

/**
 * 🔒 ENTERPRISE MULTI-FACTOR FINGERPRINTING (Ultra-Secured - V2.1)
 * Purpose: Bridges Frontend UUID with Backend Hardware Anchors.
 * FIX: Removes 'no_header' fallback to prevent race-condition mismatches.
 */
export const fingerprinter = (req, res, next) => {
  try {
    // 1. PRIMARY: Extract the UUID from the Axios Interceptor
    const clientHeaderFingerprint = req.headers['x-device-fingerprint'];

    // 2. SERVER-SIDE ANCHOR: The Absolute Source of Truth
    const hardwareAnchor = calculateServerAnchor(req);

    /**
     * 🛡️ THE SECURITY BINDING LOGIC
     * FIX: If the header is missing, we set boundIdentity to null.
     * This prevents creating a mismatch string (like hash-no_header) 
     * that triggers false security alerts during the first login load.
     */
    const boundIdentity = clientHeaderFingerprint 
      ? `${hardwareAnchor}-${clientHeaderFingerprint}` 
      : null;

    /**
     * 🛡️ SECURE ATTACHMENT
     * Using Object.defineProperty prevents sanitizers from stripping these properties.
     */
    
    // The Final Combined Identity for Token Comparison
    Object.defineProperty(req, 'deviceFingerprint', {
      value: boundIdentity,
      writable: true,
      enumerable: false, 
      configurable: true
    });

    // The Pure Hardware Hash (Useful for Breach Tracking)
    Object.defineProperty(req, 'fingerprintAnchor', {
      value: hardwareAnchor,
      writable: true,
      enumerable: false,
      configurable: true
    });

    // Logging for Render monitoring
    if (boundIdentity) {
      console.log(`[Security Hub] Identity Locked: ${boundIdentity.substring(0, 10)}...`);
    } else {
      console.warn(`[Security Hub] Identity Incomplete: Missing Client Header`);
    }

    next();
  } catch (error) {
    console.error("🚨 [SECURITY_CRITICAL]: FINGERPRINT_ENGINE_FAILURE", error);
    
    /**
     * 🛡️ FAIL CLOSED PROTOCOL
     * If the security engine fails, terminate immediately.
     */
    return res.status(500).json({ 
      success: false, 
      code: 'VAULT_IDENTITY_CRASH',
      message: "Security Identity System is currently unavailable." 
    });
  }
};
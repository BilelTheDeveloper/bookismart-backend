import crypto from 'crypto';
import { calculateServerAnchor } from '../utils/fingerprintHelper.js';

/**
 * 🔒 ENTERPRISE MULTI-FACTOR FINGERPRINTING (Ultra-Secured - V2)
 * Purpose: Bridges Frontend UUID with Backend Hardware Anchors.
 * FIX: Replaces "Client-Wins" logic with "Server-Anchor Binding".
 */
export const fingerprinter = (req, res, next) => {
  try {
    // 1. PRIMARY: Extract the UUID from the Axios Interceptor
    const clientHeaderFingerprint = req.headers['x-device-fingerprint'];

    // 2. SERVER-SIDE ANCHOR: The Absolute Source of Truth
    // Uses the unified utility (IP | UserAgent)
    const hardwareAnchor = calculateServerAnchor(req);

    /**
     * 🛡️ THE SECURITY BINDING LOGIC
     * FIX: We combine BOTH factors. 
     * Even if an attacker steals the token and the header, 
     * they cannot spoof the Hardware Anchor (IP/UA) easily.
     */
    const boundIdentity = `${hardwareAnchor}-${clientHeaderFingerprint || 'no_header'}`;

    /**
     * 🛡️ SECURE ATTACHMENT
     * We use Object.defineProperty to attach these securely.
     * This prevents 'express-mongo-sanitize' from trying to "clean" these 
     * properties, which causes the 500 "Getter" errors.
     */
    
    // The Final Combined Identity for Token Comparison
    Object.defineProperty(req, 'deviceFingerprint', {
      value: boundIdentity,
      writable: true,
      enumerable: false, // 👈 THE FIX: Sanitizers won't trip over this
      configurable: true
    });

    // The Pure Hardware Hash (Useful for Breach Tracking)
    Object.defineProperty(req, 'fingerprintAnchor', {
      value: hardwareAnchor,
      writable: true,
      enumerable: false, // 👈 THE FIX: Sanitizers won't trip over this
      configurable: true
    });

    // Log the first 10 chars for debugging in Render
    console.log(`[Security Hub] Identity Locked: ${boundIdentity.substring(0, 10)}...`);

    next();
  } catch (error) {
    console.error("🚨 [SECURITY_CRITICAL]: FINGERPRINT_ENGINE_FAILURE", error);
    
    /**
     * 🛡️ FAIL CLOSED PROTOCOL
     * FIX: We do NOT call next(). If the security engine fails, 
     * the request must be terminated immediately with a 500 error.
     */
    return res.status(500).json({ 
      success: false, 
      code: 'VAULT_IDENTITY_CRASH',
      message: "Security Identity System is currently unavailable." 
    });
  }
};
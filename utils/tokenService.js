import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { calculateServerAnchor } from './fingerprintHelper.js';

/**
 * 🔒 TOKEN SERVICE - Advanced Security Hub (Enterprise Edition)
 * Implements: Dual-Token System, Unified Device Binding, JTI Tracking, and HS256 Enforcement
 */

/**
 * @desc    Generates both Access and Refresh tokens with Unified Fingerprinting
 * @param   {Object} user - The user document
 * @param   {Object} req - The request object (required for server-side anchor calculation)
 * @param   {String} clientHeader - The x-device-fingerprint from the frontend
 */
export const generateAccessAndRefreshTokens = async (user, req, clientHeader) => {
  try {
    // 1. Unified Identity Binding
    // We calculate the same boundIdentity as the fingerprinter middleware
    const serverAnchor = calculateServerAnchor(req);
    const boundFingerprint = `${serverAnchor}-${clientHeader || 'no_header'}`;

    // 2. Create a Unique ID (jti) for this specific Access Token
    // This allows the Redis blacklist to revoke this specific session.
    const accessTokenId = crypto.randomBytes(16).toString('hex');

    // 3. Generate Access Token (Short-lived - 15 Minutes)
    const accessToken = jwt.sign(
      { 
        id: user._id, 
        role: user.role,
        fingerprint: boundFingerprint, // 🛡️ Bound to Hardware + Header
        jti: accessTokenId             // 🚨 Required for Redis Blacklist
      },
      process.env.JWT_ACCESS_SECRET,
      { 
        expiresIn: '15m',
        algorithm: 'HS256'              // 🛡️ Explicitly prevent algorithm confusion
      }
    );

    // 4. Generate Refresh Token (Long-lived - 7 Days)
    // Cryptographically strong random string
    const refreshToken = crypto.randomBytes(40).toString('hex');

    // 5. Set Expiration Date
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(refreshTokenExpiresAt.getDate() + 7);

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
      accessTokenId 
    };
  } catch (error) {
    console.error("🚨 [TOKEN_SERVICE_ERROR]:", error);
    throw new Error("Could not generate secure session tokens");
  }
};

/**
 * 🛡️ THE BINDING VALIDATOR
 * Replaces the old createDeviceFingerprint to match the new architecture
 */
export const getBoundIdentity = (req, clientHeader) => {
  const serverAnchor = calculateServerAnchor(req);
  return `${serverAnchor}-${clientHeader || 'no_header'}`;
};

/**
 * @desc    Validates the Access Token
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'] 
    });
  } catch (error) {
    return null;
  }
};
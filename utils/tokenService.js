import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * TOKEN SERVICE - Advanced Security Hub (Enterprise Edition)
 * Implements: Dual-Token System, Device Fingerprinting, JTI Tracking, and HS256 Enforcement
 */

export const generateAccessAndRefreshTokens = async (user, deviceFingerprint) => {
  try {
    // 1. Create a Unique ID (jti) for this specific Access Token
    // This allows the Redis blacklist to revoke this specific session.
    const accessTokenId = crypto.randomBytes(16).toString('hex');

    // 2. Generate Access Token (Short-lived - 15 Minutes)
    const accessToken = jwt.sign(
      { 
        id: user._id, 
        role: user.role,
        fingerprint: deviceFingerprint, // Bind token to device
        jti: accessTokenId              // 🚨 CRITICAL: Required for Redis Blacklist
      },
      process.env.JWT_ACCESS_SECRET,
      { 
        expiresIn: '15m',
        algorithm: 'HS256'              // 🛡️ Explicitly prevent algorithm confusion attacks
      }
    );

    // 3. Generate Refresh Token (Long-lived - 7 Days)
    // We use a cryptographically strong random string for maximum security.
    const refreshToken = crypto.randomBytes(40).toString('hex');

    // 4. Set Expiration Date
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(refreshTokenExpiresAt.getDate() + 7);

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt,
      accessTokenId // We return this in case the controller needs to log it
    };
  } catch (error) {
    console.error("Token Generation Error:", error);
    throw new Error("Could not generate security tokens");
  }
};

/**
 * Hashes the user-agent and IP to create a unique device ID
 * Helps detect if a token is stolen and used on a different machine
 */
export const createDeviceFingerprint = (req) => {
  const userAgent = req.headers['user-agent'] || 'unknown';
  const ip = req.ip || req.connection.remoteAddress;
  
  return crypto
    .createHash('sha256')
    .update(userAgent + ip)
    .digest('hex');
};

/**
 * Validates the Access Token
 * Updated to match the "protect" middleware algorithm requirements
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET, {
      algorithms: ['HS256'] // 🛡️ Only accept HS256
    });
  } catch (error) {
    return null;
  }
};
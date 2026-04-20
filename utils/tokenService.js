import jwt from 'jsonwebtoken';
import crypto from 'crypto';

/**
 * TOKEN SERVICE - Advanced Security Hub
 * Implements: Dual-Token System, Device Fingerprinting, and Rotation
 */

export const generateAccessAndRefreshTokens = async (user, deviceFingerprint) => {
  try {
    // 1. Generate Access Token (Short-lived - 15 Minutes)
    // Only contains essential data to keep the payload light
    const accessToken = jwt.sign(
      { 
        id: user._id, 
        role: user.role,
        fingerprint: deviceFingerprint // Bind token to device
      },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '15m' }
    );

    // 2. Generate Refresh Token (Long-lived - 7 Days)
    // We use a cryptographically strong random string instead of a JWT 
    // to prevent JWT-specific attacks on the long-lived token
    const refreshToken = crypto.randomBytes(40).toString('hex');

    // 3. Set Expiration Date
    const refreshTokenExpiresAt = new Date();
    refreshTokenExpiresAt.setDate(refreshTokenExpiresAt.getDate() + 7);

    return {
      accessToken,
      refreshToken,
      refreshTokenExpiresAt
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
 */
export const verifyAccessToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch (error) {
    return null;
  }
};
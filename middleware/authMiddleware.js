import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * 🛡️ AUTHENTICATION MIDDLEWARE (HttpOnly Cookie Edition)
 * Purpose: Protects routes by verifying the accessToken inside secure cookies.
 */
export const protect = async (req, res, next) => {
  let token;

  // 1. Extract token from HttpOnly Cookies
  // We prioritize cookies, but keep a fallback for the Authorization header 
  // just in case you use mobile apps or Postman without cookies later.
  if (req.cookies && req.cookies.accessToken) {
    token = req.cookies.accessToken;
  } else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  // 2. Gate Check: No token, no entry.
  if (!token) {
    return res.status(401).json({ message: 'Not authorized, access token missing' });
  }

  try {
    // 3. Verify Token Signature
    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);

    // 4. Attach User to request (excluding password)
    // We fetch fresh from the DB to ensure accountStatus hasn't changed.
    req.user = await User.findById(decoded.id).select('-password');
    
    if (!req.user) {
      return res.status(401).json({ message: 'User no longer exists' });
    }

    /**
     * 5. Fingerprint Validation (Device Binding)
     * Matches the current browser fingerprint against the one sealed inside the JWT.
     */
    const currentFingerprint = req.headers['x-device-fingerprint']; 
    if (decoded.fingerprint && decoded.fingerprint !== currentFingerprint) {
      console.error(`🚨 [Security Breach]: Fingerprint mismatch for user ${req.user.email}`);
      return res.status(401).json({ message: "Security Breach: Device Mismatch" });
    }

    // Success: Proceed to the controller
    next();
  } catch (error) {
    console.error(`[AUTH_MIDDLEWARE_ERROR]: ${error.message}`);
    
    // If the access token is expired, the frontend Axios interceptor 
    // will catch this 401 and call the /refresh route.
    return res.status(401).json({ 
      message: 'Session expired or invalid', 
      code: 'TOKEN_EXPIRED' 
    });
  }
};

/**
 * 👑 ADMIN AUTHORIZATION
 */
export const isAdmin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    console.warn(`⛔ [Unauthorized Access Attempt]: User ${req.user?.email} tried to access admin zone.`);
    res.status(403).json({ message: 'Access denied: Requires Admin privileges' });
  }
};
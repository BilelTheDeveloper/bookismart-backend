import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * 🔐 Protect: Ensures the user is logged in with a valid JWT
 * Now updated to look into HttpOnly Cookies for maximum security.
 */
export const protect = async (req, res, next) => {
  let token;

  // 1. Check for token in Cookies (Priority - Most Secure)
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } 
  // 2. Fallback to Authorization Header (Optional - for mobile or testing)
  else if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ error: "Not authorized, no token provided." });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Get user from the token (excluding password)
    req.user = await User.findById(decoded.id).select('-password');

    if (!req.user) {
      return res.status(401).json({ error: "Not authorized, user not found." });
    }

    next();
  } catch (error) {
    console.error("🔒 [Auth Error]: Token failed", error.message);
    res.status(401).json({ error: "Not authorized, token failed." });
  }
};

/**
 * 👑 Admin Only: Ensures the user has an admin role
 */
export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admins only." });
  }
};

/**
 * 🏢 Owner Only: Ensures the user is a Merchant/Owner
 */
export const isOwner = (req, res, next) => {
  if (req.user && (req.user.role === 'owner' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Owners only." });
  }
};
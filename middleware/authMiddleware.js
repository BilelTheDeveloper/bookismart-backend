import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Access.js'; // ✅ Imported the new Admin model

/**
 * 🔐 Protect: Ensures the user is logged in with a valid JWT
 */
export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      // Get token from header
      token = req.headers.authorization.split(' ')[1];

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
  }

  if (!token) {
    res.status(401).json({ error: "Not authorized, no token provided." });
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

/**
 * 🛡️ NEW: protectAdmin
 * Specific for the System Admin Access model
 */
export const protectAdmin = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // Use the Admin model for system-level access
      req.user = await Admin.findById(decoded.id).select('-passwordHash');

      if (!req.user || !req.user.isActive) {
        return res.status(401).json({ error: "Not authorized, admin account inactive." });
      }

      next();
    } catch (error) {
      console.error("🔒 [Admin Auth Error]:", error.message);
      res.status(401).json({ error: "Not authorized, admin token failed." });
    }
  }

  if (!token) {
    res.status(401).json({ error: "Not authorized, no admin token provided." });
  }
};

/**
 * 🔑 NEW: authorize
 * Handles flexible role checks for the Admin model (admin, support, moderator)
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.accessLevel)) {
      return res.status(403).json({ 
        error: `Forbidden: Access level '${req.user?.accessLevel}' unauthorized.` 
      });
    }
    next();
  };
};
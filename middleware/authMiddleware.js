import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Access.js'; // ✅ Imported the new Admin model

/**
 * 🔐 Protect: Ensures the user is logged in with a valid JWT (Regular Users/Owners)
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
    return res.status(401).json({ error: "Not authorized, no token provided." });
  }
};

/**
 * 👑 Admin Only: Ensures the user has an admin role (Regular User Model)
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
 * Specific for the System Admin Access model (Access.js collection)
 */
export const protectAdmin = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // ✅ Specifically look in the Admin (Access) collection
      const adminUser = await Admin.findById(decoded.id).select('-passwordHash');

      if (!adminUser) {
        return res.status(401).json({ error: "Not authorized, admin account not found." });
      }

      if (!adminUser.isActive) {
        return res.status(401).json({ error: "Not authorized, admin account inactive." });
      }

      // Attach the admin user to the request
      req.user = adminUser;
      next();
    } catch (error) {
      console.error("🔒 [Admin Auth Error]:", error.message);
      res.status(401).json({ error: "Not authorized, admin token failed." });
    }
  } else {
    // Ensuring we return here so the code doesn't proceed to "next()"
    return res.status(401).json({ error: "Not authorized, no admin token provided." });
  }
};

/**
 * 🔑 NEW: authorize
 * Handles flexible role checks for the Admin model (admin, support, moderator)
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    // Checks the 'accessLevel' field specifically found in the Admin model
    if (!req.user || !roles.includes(req.user.accessLevel)) {
      return res.status(403).json({ 
        error: `Forbidden: Access level '${req.user?.accessLevel}' unauthorized.` 
      });
    }
    next();
  };
};

export default { protect, admin, isOwner, protectAdmin, authorize };
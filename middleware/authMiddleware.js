import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Admin from '../models/Access.js'; 

/**
 * 🔐 Protect: Ensures the user is logged in (Regular Users/Owners)
 * Checks the 'User' collection.
 */
export const protect = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith('Bearer')) {
    try {
      token = req.headers.authorization.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

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
 * 👑 Admin: Checks 'role' field in the regular User model
 */
export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Admins only." });
  }
};

/**
 * 🏢 Owner: Checks 'role' field in the regular User model
 */
export const isOwner = (req, res, next) => {
  if (req.user && (req.user.role === 'owner' || req.user.role === 'admin')) {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Owners only." });
  }
};

/**
 * 🛡️ protectAdmin
 * Checks the 'Admin' (Access) collection specifically.
 * Use this for System Administration tasks.
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
    return res.status(401).json({ error: "Not authorized, no admin token provided." });
  }
};

/**
 * 🔑 authorize
 * Checks 'accessLevel' in the Admin (Access) model.
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    // Note: We use req.user.accessLevel here because that's the field in Access.js
    if (!req.user || !roles.includes(req.user.accessLevel)) {
      return res.status(403).json({ 
        error: `Forbidden: Access level '${req.user?.accessLevel}' unauthorized.` 
      });
    }
    next();
  };
};

// Default export including all methods for flexibility
export default { protect, admin, isOwner, protectAdmin, authorize };
import jwt from 'jsonwebtoken';
import User from '../models/User.js';

/**
 * 🔐 PROTECT: The Gateway
 * Verifies the JWT from HttpOnly cookies and attaches the fresh User object to the request.
 * It also checks if the account is active to prevent suspended users from making requests.
 */
export const protect = async (req, res, next) => {
  let token;

  // 1. Prioritize HttpOnly Cookie (Primary Security)
  if (req.cookies && req.cookies.token) {
    token = req.cookies.token;
  } 
  // 2. Fallback to Bearer Token (For testing/API tools)
  else if (req.headers.authorization?.startsWith('Bearer')) {
    token = req.headers.authorization.split(' ')[1];
  }

  if (!token) {
    return res.status(401).json({ 
      error: "Authentication required. Please log in to continue." 
    });
  }

  try {
    // Verify the JWT integrity
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch the user and ensure they still exist in the DB
    // We select the role and accountStatus specifically for the next middleware checks
    const currentUser = await User.findById(decoded.id).select('-password -otpCodes');

    if (!currentUser) {
      return res.status(401).json({ error: "The user belonging to this token no longer exists." });
    }

    // 🛡️ SECURITY CHECK: Prevent access if account is not active
    // This handles 'suspended', 'on_boarding', or 'review' statuses from your model
    if (currentUser.accountStatus !== 'active' && currentUser.role !== 'admin') {
      return res.status(403).json({ 
        error: `Access denied. Your account status is: ${currentUser.accountStatus.replace('_', ' ')}.` 
      });
    }

    // Grant access to the request object
    req.user = currentUser;
    next();
  } catch (error) {
    console.error("🔒 [Auth Error]:", error.message);
    
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: "Your session has expired. Please log in again." });
    }
    
    res.status(401).json({ error: "Invalid token. Access denied." });
  }
};

/**
 * 👑 ADMIN ONLY
 * Strict check for the 'admin' role.
 */
export const admin = (req, res, next) => {
  if (req.user && req.user.role === 'admin') {
    next();
  } else {
    console.warn(`🚫 [Security Warning]: Unauthorized Admin access attempt by ${req.user?.email}`);
    res.status(403).json({ error: "Restricted. Administrative privileges required." });
  }
};

/**
 * 🏢 OWNER / MERCHANT ONLY
 * Allows 'owner' role. Admins are also allowed to bypass for troubleshooting.
 */
export const isOwner = (req, res, next) => {
  const allowedRoles = ['owner', 'admin'];
  
  if (req.user && allowedRoles.includes(req.user.role)) {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Merchant/Owner access required." });
  }
};

/**
 * 👤 CUSTOMER ONLY
 */
export const isCustomer = (req, res, next) => {
  if (req.user && req.user.role === 'customer') {
    next();
  } else {
    res.status(403).json({ error: "Access denied. Customer account required." });
  }
};

/**
 * 🛠️ AUTHORIZE ROLES (Advanced Helper)
 * Use this to restrict routes to specific multiple roles easily.
 * Example: router.get('/stats', protect, authorize('admin', 'owner'))
 */
export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ 
        error: `Access denied. This action is restricted to: ${roles.join(', ')}` 
      });
    }
    next();
  };
};
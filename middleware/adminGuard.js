import User from '../models/User.js';

/**
 * 🔒 MILITARY-GRADE ADMIN GUARD
 * This middleware acts as the second "Checkpoint" after the token is verified.
 * It prevents "Ghost Admins" (users whose roles were revoked but still have a valid token).
 */
export const adminGuard = async (req, res, next) => {
  try {
    // 1. Check if 'protect' middleware successfully attached the user
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required. Access denied." 
      });
    }

    // 2. Real-Time Database Validation
    // We fetch the latest status directly from DB to prevent stale token bypass
    const user = await User.findById(req.user._id).select('role accountStatus kyc');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User account no longer exists." 
      });
    }

    // 3. Status Integrity Check
    // Even if the user is an admin, they cannot enter if they are suspended
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. Your account is currently: ${user.accountStatus}` 
      });
    }

    // 4. Role Hierarchy Verification
    // According to your User.js enum: ['owner', 'admin', 'moderator']
    // Only 'admin' and 'owner' are allowed into the Dashboard
    const authorizedRoles = ['admin', 'owner'];
    
    if (!authorizedRoles.includes(user.role)) {
      console.warn(`[SECURITY ALERT]: Unauthorized Admin access attempt by ${user.email} from IP ${req.headers['x-forwarded-for'] || req.socket.remoteAddress}`);
      
      return res.status(403).json({ 
        success: false, 
        message: "Forbidden: You do not have administrative clearance for this zone." 
      });
    }

    // 5. Audit Logging (Optional but recommended for high-security systems)
    // You can log who accessed the admin zone here.
    
    next(); // Security checks passed. Welcome to the Vault.
    
  } catch (error) {
    console.error(`[ADMIN_GUARD_CRASH]: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: "Internal Security Engine Error." 
    });
  }
};
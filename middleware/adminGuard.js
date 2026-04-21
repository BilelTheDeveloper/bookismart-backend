import User from '../models/User.js';

/**
 * 🔒 MILITARY-GRADE ADMIN GUARD (Cookie-Protocol Edition)
 * Purpose: Acts as the second "Checkpoint" after the token is verified.
 * Logic: Validates the user's live role and status against the database.
 */
export const adminGuard = async (req, res, next) => {
  try {
    // 1. Check if 'protect' middleware successfully attached the user
    // Since we use HttpOnly cookies, the user must be authenticated first.
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication required. Access denied." 
      });
    }

    // 2. Real-Time Database Validation
    // We fetch fresh data to ensure the HttpOnly cookie hasn't outlived the user's permissions.
    const user = await User.findById(req.user._id).select('role accountStatus kyc email');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "User account no longer exists." 
      });
    }

    // 3. Status Integrity Check
    // Prevents access if an account was suspended AFTER the cookie was issued.
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: `Access denied. Your account is currently: ${user.accountStatus}` 
      });
    }

    /**
     * 4. Role Hierarchy Verification
     * IMPORTANT: We keep 'admin' and 'owner' as authorized for the backend logic,
     * but your frontend AdminGuard will filter which dashboard they actually see.
     */
    const authorizedRoles = ['admin', 'owner'];
    
    if (!authorizedRoles.includes(user.role)) {
      console.warn(`[SECURITY ALERT]: Unauthorized access attempt by ${user.email}`);
      
      return res.status(403).json({ 
        success: false, 
        message: "Forbidden: You do not have administrative clearance for this zone." 
      });
    }

    // 5. Context Injection
    // We update req.user with the fresh DB data for the next controller.
    req.user = user;

    next(); // Security checks passed. Welcome to the Vault.
    
  } catch (error) {
    console.error(`[ADMIN_GUARD_CRASH]: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: "Internal Security Engine Error." 
    });
  }
};
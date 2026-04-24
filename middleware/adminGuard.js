import User from '../models/User.js';

/**
 * 🔒 MILITARY-GRADE ADMIN GUARD (Enterprise Edition)
 * * REQUIREMENTS:
 * 1. Must be placed AFTER the 'protect' middleware in your routes.
 * 2. Relies on the verified 'req.user' context provided by the Vault.
 */
export const adminGuard = async (req, res, next) => {
  try {
    /* ── 1. CONTEXT INTEGRITY CHECK ──
       Ensure the 'protect' middleware has already successfully 
       authenticated the user and bound them to the request. */
    if (!req.user) {
      return res.status(401).json({ 
        success: false, 
        message: "Authentication context missing. Access denied.",
        code: "UNAUTHORIZED" 
      });
    }

    /* ── 2. REAL-TIME CLEARANCE RE-VERIFICATION ──
       Even though 'protect' did a DB check, the AdminGuard performs a 
       specific role-fetch to ensure permissions haven't been revoked 
       in the last millisecond. */
    const user = await User.findById(req.user._id).select('role accountStatus email');

    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "Identity could not be verified in the Vault.",
        code: "USER_NOT_FOUND"
      });
    }

    /* ── 3. STATUS LOCK ──
       Hard-reject any user whose status is not 'active', even if they 
       have an admin role. This prevents 'Banned Admins' from accessing. */
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: `Administrative access restricted. Account status: ${user.accountStatus}`,
        code: "ACCOUNT_RESTRICTED"
      });
    }

    /* ── 4. ROLE HIERARCHY ENFORCEMENT ──
       Only 'admin' and 'owner' bypass this gate. 
       We use an allowlist approach for maximum security. */
    const AUTHORIZED_ADMIN_ROLES = ['admin', 'owner'];
    
    if (!AUTHORIZED_ADMIN_ROLES.includes(user.role)) {
      // 🚨 SECURITY AUDIT: Log the attempt for forensics
      console.warn(JSON.stringify({
        level: 'SECURITY_ALERT',
        msg: 'Unauthorized Administrative Access Attempt',
        user: user.email,
        attemptedRole: user.role,
        ts: new Date().toISOString()
      }));
      
      return res.status(403).json({ 
        success: false, 
        message: "Access Denied: You do not have the required clearance level.",
        code: "FORBIDDEN" 
      });
    }

    /* ── 5. FINAL CONTEXT INJECTION ──
       Inject the fully refreshed user object into the request for 
       downstream controllers (e.g., req.user.role will be available). */
    req.user = user;

    next(); // All clearance checks passed.
    
  } catch (error) {
    // 🛡️ Fail-Safe: On any internal crash, we block access (Fail Closed)
    console.error(`[ADMIN_GUARD_CRASH]: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: "Internal Security Engine failure.",
      code: "INTERNAL_SECURITY_ERROR"
    });
  }
};
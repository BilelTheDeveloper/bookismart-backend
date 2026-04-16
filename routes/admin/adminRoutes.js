import express from 'express';
const router = express.Router();

// Import the controller from your specific path
import { 
  grantAccess, 
  loginAdmin, 
  getAllAdmins, 
  toggleAdminStatus 
} from '../../controllers/admin/adminAccessController.js';

// Import your middleware
// protectAdmin: Verifies the JWT token and finds the admin in the database
// authorize: Checks if req.user.accessLevel matches the required role
import { protectAdmin, authorize } from '../../middleware/authMiddleware.js';

/**
 * @route   POST /api/admin/access/auth/login
 * @desc    Public login for all access levels (admin, support, moderator)
 */
router.post('/auth/login', loginAdmin);

/**
 * --- PROTECTED ROUTES ---
 * All routes below this line require a valid token and 'admin' level permissions.
 * These routes are usually mounted at /api/admin/access in your server.js
 */

// ✅ Get the full list of system users for the Access Control UI
// Final Route: GET /api/admin/access/list
router.get(
  '/list', 
  protectAdmin, 
  authorize('admin'), 
  getAllAdmins
);

// ✅ Create a new access record (Grant access to someone else)
// Final Route: POST /api/admin/access/grant
router.post(
  '/grant', 
  protectAdmin, 
  authorize('admin'), 
  grantAccess
);

// ✅ Deactivate or Activate an access record (The "Kill Switch")
// Final Route: PATCH /api/admin/access/toggle/:id
router.patch(
  '/toggle/:id', 
  protectAdmin, 
  authorize('admin'), 
  toggleAdminStatus
);

export default router;
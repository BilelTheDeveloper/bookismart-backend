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
// protectAdmin: Verifies the JWT token
// authorize: Checks if req.user.accessLevel === 'admin'
import { protectAdmin, authorize } from '../../middleware/authMiddleware.js';

/**
 * @route   POST /api/admin/access/auth/login
 * @desc    Public login for all access levels (admin, support, moderator)
 */
router.post('/auth/login', loginAdmin);

/**
 * --- PROTECTED ROUTES ---
 * All routes below this line require a valid token and 'admin' level permissions.
 * These are mounted at /api/admin/access in server.js
 */

// ✅ Final Route: GET /api/admin/access/list
// Get the full list of system users for the Access Control UI
router.get(
  '/list', 
  protectAdmin, 
  authorize('admin'), 
  getAllAdmins
);

// ✅ Final Route: POST /api/admin/access/grant
// Create a new access record (Grant access to someone else)
router.post(
  '/grant', 
  protectAdmin, 
  authorize('admin'), 
  grantAccess
);

// ✅ Final Route: PATCH /api/admin/access/toggle/:id
// Deactivate or Activate an access record (The "Kill Switch")
router.patch(
  '/toggle/:id', 
  protectAdmin, 
  authorize('admin'), 
  toggleAdminStatus
);

export default router;
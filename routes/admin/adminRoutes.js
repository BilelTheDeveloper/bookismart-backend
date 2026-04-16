import express from 'express';
const router = express.Router();

// Import the controller from your specific path
import { 
  grantAccess, 
  loginAdmin, 
  getAllAdmins, 
  toggleAdminStatus 
} from '../../controllers/admin/adminAccessController.js';

// Import your middleware (Ensure you have these created to protect the routes)
// protectAdmin: Verifies the JWT token
// authorize: Checks if req.user.accessLevel === 'admin'
import { protectAdmin, authorize } from '../../middleware/authMiddleware.js';

/**
 * @route   POST /api/v1/admin/auth/login
 * @desc    Public login for all access levels (admin, support, moderator)
 */
router.post('/auth/login', loginAdmin);

/**
 * --- PROTECTED ROUTES ---
 * All routes below this line require a valid token and 'admin' level permissions
 */

// Get the full list of system users for the Access Control UI
router.get(
  '/access/list', 
  protectAdmin, 
  authorize('admin'), 
  getAllAdmins
);

// Create a new access record (Grant access to someone else)
router.post(
  '/access/grant', 
  protectAdmin, 
  authorize('admin'), 
  grantAccess
);

// Deactivate or Activate an access record (The "Kill Switch")
router.patch(
  '/access/toggle/:id', 
  protectAdmin, 
  authorize('admin'), 
  toggleAdminStatus
);

export default router;
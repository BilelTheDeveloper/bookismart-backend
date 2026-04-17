import express from 'express';
// ✅ Updated import path to match your controller naming convention
import { loginController } from '../controllers/loginController.js';

const router = express.Router();

/**
 * @route   POST /api/auth/login
 * @desc    Handle authentication for Admins, Owners, and Customers
 * @access  Public
 * @note    This route issues an HttpOnly cookie for session management.
 */
router.post('/login', loginController);

/**
 * @note You can add other entry-level auth routes here in the future,
 * such as /forgot-password or /reset-password.
 */

// Exporting as default to match your server.js: app.use('/api/auth', loginRoutes);
export default router;
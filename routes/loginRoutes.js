import express from 'express';
// Ensure the path and extension (.js) are correct for your structure
import { loginController } from '../controllers/logincontroller.js';

const loginRoutes = express.Router();

/**
 * @route   POST /api/auth/login
 * @desc    Handle merchant and admin authentication
 * @access  Public
 */
loginRoutes.post('/login', loginController);

// Exporting as default so it matches your server.js import style
export default loginRoutes;
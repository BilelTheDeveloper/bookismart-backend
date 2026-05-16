import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  getSettings,
  updateProfile,
  changePassword,
  updateNotifications,
  getBilling,
} from '../controllers/settingsController.js';

const router = express.Router();
router.use(protect, requireRole('owner'));

router.get('/', getSettings);
router.patch('/profile', updateProfile);
router.patch('/password', changePassword);
router.patch('/notifications', updateNotifications);
router.get('/billing', getBilling);

export default router;

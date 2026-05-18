import express from 'express';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  getSettings,
  updateProfile,
  changePassword,
  updateNotifications,
  getBilling,
  getActivityLog,
} from '../controllers/settingsController.js';

const router = express.Router();
router.use(protect, requireRole('owner'));

const passwordLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  keyGenerator: (req) => req.user?._id?.toString() || ipKeyGenerator(req),
  message: { success: false, message: 'Too many password change attempts. Try again in 1 hour.' },
});

router.get('/', getSettings);
router.patch('/profile', updateProfile);
router.patch('/password', passwordLimiter, changePassword);
router.patch('/notifications', updateNotifications);
router.get('/billing', getBilling);
router.get('/activity-log', getActivityLog);

export default router;

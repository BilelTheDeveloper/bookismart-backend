import express from 'express';
import rateLimit from 'express-rate-limit';
import { globalSearch } from '../controllers/searchController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

const searchLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  keyGenerator: (req) => req.user?._id?.toString() || req.ip,
  message: { success: false, message: 'Too many search requests.' },
});

router.get('/', protect, searchLimiter, globalSearch);

export default router;

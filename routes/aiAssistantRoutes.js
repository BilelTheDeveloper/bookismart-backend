import express from 'express';
const router = express.Router();
import { protect } from '../middleware/authMiddleware.js';
import { getSmartInsight } from '../controllers/aiAssistantController.js';

router.get('/insights/:type', protect, getSmartInsight);

export default router;

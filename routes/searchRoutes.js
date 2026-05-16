import express from 'express';
import { globalSearch } from '../controllers/searchController.js';
import { protect } from '../middleware/authMiddleware.js';

const router = express.Router();

// GET /api/merchant/search?q=query
router.get('/', protect, globalSearch);

export default router;

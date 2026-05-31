import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import {
  getBranches, createBranch, updateBranch, deleteBranch,
} from '../controllers/branchController.js';

const router = express.Router();

router.get('/',     protect, getBranches);
router.post('/',    protect, createBranch);
router.put('/:id',  protect, updateBranch);
router.delete('/:id', protect, deleteBranch);

export default router;

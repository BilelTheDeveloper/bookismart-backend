import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import { getBlocked, blockCustomer, unblockCustomer, getOffenders } from '../controllers/noShowController.js';

const router = express.Router();

router.get('/blocked',       protect, getBlocked);
router.post('/block',        protect, blockCustomer);
router.delete('/blocked/:id', protect, unblockCustomer);
router.get('/offenders',     protect, getOffenders);

export default router;

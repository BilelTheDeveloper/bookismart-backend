import express from 'express';
import { protect } from '../middleware/authMiddleware.js';
import upload from '../config/cloudinary.js';
import { getKYCStatus, submitKYC } from '../controllers/kycController.js';

const router = express.Router();

router.use(protect);

router.get('/status', getKYCStatus);

router.post('/submit', upload.fields([
  { name: 'idFront',       maxCount: 1 },
  { name: 'idBack',        maxCount: 1 },
  { name: 'livenessVideo', maxCount: 1 },
]), submitKYC);

export default router;

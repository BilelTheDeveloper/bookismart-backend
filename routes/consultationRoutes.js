import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  startConsultationFromBooking,
  getOwnerConsultations,
  updateConsultationTimer,
  addConsultationMessage,
  completeConsultation,
  getCustomerConsultationHistory,
} from '../controllers/consultationController.js';

const ownerConsultationRouter = express.Router();
ownerConsultationRouter.use(protect, requireRole('owner'));
ownerConsultationRouter.get('/', getOwnerConsultations);
ownerConsultationRouter.get('/customer-history', getCustomerConsultationHistory);
ownerConsultationRouter.post('/from-booking/:bookingId', startConsultationFromBooking);
ownerConsultationRouter.patch('/:consultationId/timer', updateConsultationTimer);
ownerConsultationRouter.patch('/:consultationId/complete', completeConsultation);
ownerConsultationRouter.post('/:consultationId/messages', addConsultationMessage);
export { ownerConsultationRouter };

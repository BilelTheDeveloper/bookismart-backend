import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import { customerProtect } from '../middleware/customerAuth.js';
import {
  startConsultationFromBooking,
  getOwnerConsultations,
  getConsultationQueue,
  updateConsultationTimer,
  addConsultationMessage,
  completeConsultation,
  getCustomerConsultationHistory,
  getCustomerActiveSession,
} from '../controllers/consultationController.js';

/* ── Owner router ── */
const ownerConsultationRouter = express.Router();
ownerConsultationRouter.use(protect, requireRole('owner'));

ownerConsultationRouter.get('/',                               getOwnerConsultations);
ownerConsultationRouter.get('/queue',                          getConsultationQueue);
ownerConsultationRouter.get('/customer-history',               getCustomerConsultationHistory);
ownerConsultationRouter.post('/from-booking/:bookingId',       startConsultationFromBooking);
ownerConsultationRouter.patch('/:consultationId/timer',        updateConsultationTimer);
ownerConsultationRouter.patch('/:consultationId/complete',     completeConsultation);
ownerConsultationRouter.post('/:consultationId/messages',      addConsultationMessage);

/* ── Customer portal router ── */
const customerConsultationRouter = express.Router();
customerConsultationRouter.get('/active', customerProtect, getCustomerActiveSession);

export { ownerConsultationRouter, customerConsultationRouter };

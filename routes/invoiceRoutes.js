import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  createInvoice,
  listInvoices,
  getInvoice,
  updateInvoice,
  deleteInvoice,
  sendInvoiceEmail,
  markInvoicePaid,
} from '../controllers/invoiceController.js';

const router = express.Router();
router.use(protect, requireRole('owner'));

router.get('/', listInvoices);
router.post('/', createInvoice);
router.get('/:id', getInvoice);
router.put('/:id', updateInvoice);
router.delete('/:id', deleteInvoice);
router.post('/:id/send', sendInvoiceEmail);
router.patch('/:id/mark-paid', markInvoicePaid);

export default router;

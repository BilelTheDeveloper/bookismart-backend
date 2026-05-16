import express from 'express';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import {
  createTransaction,
  listTransactions,
  updateTransaction,
  deleteTransaction,
  getPLSummary,
  exportTransactionsCSV,
} from '../controllers/financeController.js';

const router = express.Router();
router.use(protect, requireRole('owner'));

router.get('/transactions', listTransactions);
router.post('/transactions', createTransaction);
router.put('/transactions/:id', updateTransaction);
router.delete('/transactions/:id', deleteTransaction);
router.get('/pl-summary', getPLSummary);
router.get('/export/csv', exportTransactionsCSV);

export default router;

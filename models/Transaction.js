import mongoose from 'mongoose';

const INCOME_CATEGORIES = ['booking_revenue', 'online_payment', 'tip', 'other_income'];
const EXPENSE_CATEGORIES = ['rent', 'salaries', 'tools_equipment', 'marketing', 'utilities', 'maintenance', 'supplies', 'insurance', 'taxes', 'other_expense'];

const TransactionSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  type: {
    type: String,
    enum: ['income', 'expense'],
    required: true,
  },
  amount: {
    type: Number,
    required: true,
    min: 0,
  },
  currency: {
    type: String,
    default: 'TND',
  },
  category: {
    type: String,
    required: true,
  },
  description: {
    type: String,
    required: true,
    maxlength: 300,
    trim: true,
  },
  notes: {
    type: String,
    maxlength: 1000,
    default: '',
    trim: true,
  },
  date: {
    type: Date,
    required: true,
    default: Date.now,
  },
  referenceBookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null,
  },
  referenceInvoiceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Invoice',
    default: null,
  },
  tags: [{
    type: String,
    trim: true,
    maxlength: 50,
  }],
  isRecurring: {
    type: Boolean,
    default: false,
  },
  recurringFrequency: {
    type: String,
    enum: ['weekly', 'monthly', 'quarterly', 'yearly', null],
    default: null,
  },
}, { timestamps: true });

TransactionSchema.index({ ownerId: 1, date: -1 });
TransactionSchema.index({ ownerId: 1, type: 1, date: -1 });

const Transaction = mongoose.model('Transaction', TransactionSchema);
export default Transaction;
export { INCOME_CATEGORIES, EXPENSE_CATEGORIES };

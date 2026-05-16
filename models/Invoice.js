import mongoose from 'mongoose';

let invoiceCounter = null;

const InvoiceItemSchema = new mongoose.Schema({
  description: { type: String, required: true, trim: true, maxlength: 200 },
  quantity:    { type: Number, required: true, min: 0.01, default: 1 },
  unitPrice:   { type: Number, required: true, min: 0 },
  total:       { type: Number, required: true, min: 0 },
}, { _id: false });

const InvoiceSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  invoiceNumber: {
    type: String,
    unique: true,
    trim: true,
  },
  customer: {
    name:  { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    phone: { type: String, default: '', trim: true },
    address: { type: String, default: '', trim: true },
  },
  bookingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Booking',
    default: null,
  },
  items: {
    type: [InvoiceItemSchema],
    validate: { validator: (v) => v.length > 0, message: 'Invoice must have at least one item.' },
  },
  subtotal:  { type: Number, required: true, min: 0 },
  taxRate:   { type: Number, default: 19, min: 0, max: 100 },
  taxAmount: { type: Number, required: true, min: 0 },
  discount:  { type: Number, default: 0, min: 0 },
  total:     { type: Number, required: true, min: 0 },

  status: {
    type: String,
    enum: ['draft', 'sent', 'paid', 'overdue', 'cancelled'],
    default: 'draft',
  },
  notes:      { type: String, default: '', maxlength: 1000, trim: true },
  issuedDate: { type: Date, default: Date.now },
  dueDate:    { type: Date, required: true },
  sentAt:     { type: Date, default: null },
  paidAt:     { type: Date, default: null },

  currency: { type: String, default: 'TND' },
}, { timestamps: true });

InvoiceSchema.index({ ownerId: 1, createdAt: -1 });
InvoiceSchema.index({ ownerId: 1, status: 1 });

InvoiceSchema.pre('save', async function (next) {
  if (!this.invoiceNumber) {
    const year = new Date().getFullYear();
    const count = await mongoose.model('Invoice').countDocuments({ ownerId: this.ownerId });
    this.invoiceNumber = `INV-${year}-${String(count + 1).padStart(4, '0')}`;
  }
  next();
});

const Invoice = mongoose.model('Invoice', InvoiceSchema);
export default Invoice;

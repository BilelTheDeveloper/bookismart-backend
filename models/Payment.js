import mongoose from 'mongoose';

/**
 * Payment — a single payment attempt (deposit, full pay, or manual record).
 * Provider integration is env-gated (Flouci / Konnect); manual records need no provider.
 */
const PaymentSchema = new mongoose.Schema({
  ownerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking' },

  kind:     { type: String, enum: ['deposit', 'full', 'manual'], default: 'deposit' },
  amount:   { type: Number, required: true, min: 0 },
  currency: { type: String, default: 'TND' },

  provider:    { type: String, enum: ['flouci', 'konnect', 'manual'], default: 'manual' },
  providerRef: { type: String, default: '', index: true },
  payUrl:      { type: String, default: '' },

  status:  { type: String, enum: ['pending', 'paid', 'failed', 'cancelled'], default: 'pending' },

  customerName:  { type: String, default: '' },
  customerEmail: { type: String, default: '', lowercase: true, trim: true },
  customerPhone: { type: String, default: '' },

  meta:   { type: mongoose.Schema.Types.Mixed },
  paidAt: { type: Date },
}, { timestamps: true });

PaymentSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

export default mongoose.model('Payment', PaymentSchema);

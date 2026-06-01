import mongoose from 'mongoose';

/**
 * CustomerPackage — an issued / sold instance of a Package for a specific customer.
 * Tracks remaining sessions (package), expiry (membership), or balance (giftcard).
 */
const CustomerPackageSchema = new mongoose.Schema({
  ownerId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  packageId: { type: mongoose.Schema.Types.ObjectId, ref: 'Package' },

  kind:      { type: String, enum: ['package', 'membership', 'giftcard'], required: true },
  name:      { type: String, default: '' },

  customerName:  { type: String, default: '', trim: true },
  customerEmail: { type: String, default: '', lowercase: true, trim: true },
  customerPhone: { type: String, default: '', trim: true },

  // package
  sessionsTotal: { type: Number, default: 0 },
  sessionsUsed:  { type: Number, default: 0 },

  // membership
  startsAt:  { type: Date },
  expiresAt: { type: Date },

  // giftcard
  code:    { type: String, default: '', index: true },
  value:   { type: Number, default: 0 },
  balance: { type: Number, default: 0 },

  pricePaid: { type: Number, default: 0 },
  status:    { type: String, enum: ['active', 'used', 'expired', 'cancelled'], default: 'active' },

  redemptions: [{
    date:   { type: Date, default: Date.now },
    amount: { type: Number, default: 0 }, // sessions used or gift amount redeemed
    note:   { type: String, default: '' },
  }],
}, { timestamps: true });

CustomerPackageSchema.index({ ownerId: 1, status: 1, kind: 1 });
CustomerPackageSchema.index({ ownerId: 1, customerEmail: 1 });

export default mongoose.model('CustomerPackage', CustomerPackageSchema);

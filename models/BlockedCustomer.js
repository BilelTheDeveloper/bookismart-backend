import mongoose from 'mongoose';

/**
 * BlockedCustomer — a customer (by email/phone) an owner has blocked from
 * booking again. Enforced in the public booking flow.
 */
const BlockedCustomerSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  name:    { type: String, default: '', trim: true },
  email:   { type: String, default: '', lowercase: true, trim: true },
  phone:   { type: String, default: '', trim: true },
  reason:  { type: String, default: '', maxlength: 200 },
}, { timestamps: true });

BlockedCustomerSchema.index({ ownerId: 1, email: 1 });
BlockedCustomerSchema.index({ ownerId: 1, phone: 1 });

export default mongoose.model('BlockedCustomer', BlockedCustomerSchema);

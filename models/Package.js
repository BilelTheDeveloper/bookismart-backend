import mongoose from 'mongoose';

/**
 * Package — a sellable offer an owner creates.
 *   kind: 'package'    → N prepaid sessions
 *         'membership' → time-based access (durationDays)
 *         'giftcard'   → a stored-value card (value)
 */
const PackageSchema = new mongoose.Schema({
  ownerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  kind:        { type: String, enum: ['package', 'membership', 'giftcard'], required: true },
  name:        { type: String, required: true, trim: true, maxlength: 100 },
  description: { type: String, default: '', maxlength: 400 },
  price:       { type: Number, default: 0, min: 0 },

  sessions:     { type: Number, default: 0, min: 0 },   // package: number of sessions
  durationDays: { type: Number, default: 0, min: 0 },   // membership: validity in days
  value:        { type: Number, default: 0, min: 0 },   // giftcard: face value

  serviceTitle: { type: String, default: '', trim: true }, // optional: applies to this service
  color:        { type: String, default: '#6366f1' },
  active:       { type: Boolean, default: true },
}, { timestamps: true });

PackageSchema.index({ ownerId: 1, kind: 1, active: 1 });

export default mongoose.model('Package', PackageSchema);

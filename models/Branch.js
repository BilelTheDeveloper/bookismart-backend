import mongoose from 'mongoose';

/**
 * Branch — a single physical location belonging to an organization account.
 *
 * Scoped to the owning User (ownerId). Only accounts with accountType === 'organization'
 * are allowed to create more than one branch. Bookings/staff can later reference branchId
 * to enable per-location operations and cross-branch analytics.
 */
const DayHoursSchema = new mongoose.Schema({
  day:   { type: String, enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], required: true },
  open:  { type: String, default: '09:00' },
  close: { type: String, default: '18:00' },
  closed:{ type: Boolean, default: false },
}, { _id: false });

const BranchSchema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

  name:    { type: String, required: true, trim: true, maxlength: 80 },
  address: { type: String, default: '', trim: true, maxlength: 200 },
  city: {
    type: String,
    enum: [
      "Ariana", "Beja", "Ben Arous", "Bizerte", "Gabes", "Gafsa",
      "Jendouba", "Kairouan", "Kasserine", "Kebili", "Kef", "Mahdia",
      "Manouba", "Medenine", "Monastir", "Nabeul", "Sfax", "Sidi Bouzid",
      "Siliana", "Sousse", "Tataouine", "Tozeur", "Tunis", "Zaghouan"
    ],
    required: true,
  },
  phone:   { type: String, default: '', trim: true },

  hours:   { type: [DayHoursSchema], default: [] },

  isMain:    { type: Boolean, default: false },  // the headquarters / primary location
  isActive:  { type: Boolean, default: true },

  // Lightweight rollups (kept simple; real aggregation can come later)
  staffCount: { type: Number, default: 0 },

}, { timestamps: true });

BranchSchema.index({ ownerId: 1, isActive: 1 });

export default mongoose.model('Branch', BranchSchema);

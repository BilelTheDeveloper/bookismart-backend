import mongoose from 'mongoose';

const AllowedPageSchema = new mongoose.Schema({
  pageKey: {
    type: String,
    enum: ['bookings', 'customers', 'finance', 'chat', 'invoices', 'loyalty', 'work_mode', 'recruitment', 'analytics'],
    required: true,
  },
  accessLevel: {
    type: String,
    enum: ['read', 'full'],
    default: 'full',
  },
}, { _id: false });

const ScheduleSlotSchema = new mongoose.Schema({
  day:   { type: String, enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], required: true },
  start: { type: String, default: '09:00' },
  end:   { type: String, default: '17:00' },
  isOff: { type: Boolean, default: false },
}, { _id: false });

const StaffSchema = new mongoose.Schema({

  /* ── Core identity ── */
  ownerId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fullName: { type: String, required: true, trim: true },
  email:    { type: String, required: true, lowercase: true, trim: true },
  phone:    { type: String, default: '' },

  /* ── Role & profile ── */
  role:       { type: String, enum: ['manager', 'staff', 'receptionist'], default: 'staff' },
  profilePic: { type: String, default: '' },
  skills:     [{ type: String, trim: true }],
  schedule:   [ScheduleSlotSchema],
  notes:      { type: String, default: '', maxlength: 1000 },

  /* ── Invite / registration ── */
  requireKyc:               { type: Boolean, default: true },
  registrationToken:        { type: String, default: '' },
  registrationTokenExpiry:  { type: Date },
  openedAt:                 { type: Date },        // first time link was clicked
  profileStepDone:          { type: Boolean, default: false },

  /* ── OTP ── */
  otpCode:   { type: String },
  otpExpiry: { type: Date },

  /* ── Auth ── */
  password: { type: String },

  /* ── KYC ── */
  livenessPhoto:   { type: String },
  idFront:         { type: String },
  idBack:          { type: String },
  rejectionReason: { type: String },

  /* ── Permissions (owner-configured) ── */
  allowedPages: { type: [AllowedPageSchema], default: [] },

  /* ── Session vault ── */
  refreshTokens: [{
    tokenHash: { type: String },
    deviceId:  { type: String },
    expiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  }],
  lastLogin: { type: Date },

  /* ── Lifecycle status ── */
  // invited      → owner created, link sent
  // opened       → staff clicked the link
  // pending_kyc  → completed OTP + password, KYC not yet uploaded
  // under_review → KYC submitted, awaiting admin
  // active       → admin approved
  // rejected     → admin rejected
  // inactive     → owner deactivated
  // expired      → invite not completed within 7 days
  status: {
    type: String,
    enum: ['invited', 'opened', 'pending_kyc', 'under_review', 'active', 'rejected', 'inactive', 'expired'],
    default: 'invited',
  },

}, { timestamps: true });

StaffSchema.index({ ownerId: 1, status: 1 });
StaffSchema.index({ ownerId: 1, email: 1 }, { unique: true });

export default mongoose.model('Staff', StaffSchema);

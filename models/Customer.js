import mongoose from 'mongoose';

const AllowedPageSchema = new mongoose.Schema({
  pageKey: {
    type: String,
    enum: ['appointments', 'invoices', 'loyalty', 'booking'],
    required: true,
  },
  accessLevel: {
    type: String,
    enum: ['read', 'full'],
    default: 'read',
  },
}, { _id: false });

const CustomerSchema = new mongoose.Schema({
  // Core identity
  fullName: { type: String, required: true, trim: true },
  phone:    { type: String, required: true },
  email:    { type: String, required: true, lowercase: true, trim: true },
  password: { type: String },

  // Profile picture (uploaded by owner at initiation)
  profilePicture: { type: String },

  // Business relationship
  ownerId:      { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  businessName: { type: String }, // denormalized snapshot for admin view

  // Magic-link token for the registration journey
  registrationToken:       { type: String },
  registrationTokenExpiry: { type: Date },

  // OTP verification
  otpCode:   { type: String },
  otpExpiry: { type: Date },

  // KYC uploads (Cloudinary URLs)
  livenessPhoto: { type: String },
  idFront:       { type: String },
  idBack:        { type: String },

  // Lifecycle status
  // invited       → owner created, OTP sent to customer
  // pending_kyc   → customer verified OTP + set password, KYC not yet uploaded
  // under_review  → KYC submitted, awaiting admin decision
  // active        → admin approved
  // rejected      → admin rejected
  status: {
    type: String,
    enum: ['invited', 'pending_kyc', 'under_review', 'active', 'rejected'],
    default: 'invited',
  },
  rejectionReason: { type: String },

  // Page access granted by owner (empty = profile only)
  allowedPages: { type: [AllowedPageSchema], default: [] },

  // Refresh-token vault for portal sessions
  refreshTokens: [{
    tokenHash: { type: String },
    deviceId:  { type: String },
    expiresAt: { type: Date },
    createdAt: { type: Date, default: Date.now },
  }],

  lastLogin: { type: Date },
}, { timestamps: true });

// One customer per email per business
CustomerSchema.index({ email: 1, ownerId: 1 }, { unique: true });

const Customer = mongoose.model('Customer', CustomerSchema);
export default Customer;

import mongoose from 'mongoose';

const UserSchema = new mongoose.Schema({
  // --- 1. CORE IDENTITY & AUTH (Steps 1 & 3) ---
  fullName: { 
    type: String, 
    required: true, 
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true,
    trim: true
  },
  phone: { 
    type: String, 
    required: true, 
    unique: true 
  },
  password: { 
    type: String, 
    required: true 
  },
  role: {
    type: String,
    enum: ['owner', 'admin'],
    default: 'owner'
  },

  // --- 1b. ACCOUNT TYPE (Individual professional vs Organization) ---
  // 'individual'  → solo professional (barber, doctor, coach…), single location.
  // 'organization' → clinic / salon chain / franchise with multiple branches & a team.
  // NOTE: the full Organization/Branch/Member system is deferred; this flag drives the
  // signup experience, billing tier (org tiers are priced by seats + branches) and gating.
  accountType: {
    type: String,
    enum: ['individual', 'organization'],
    default: 'individual',
  },
  organization: {
    name: { type: String, trim: true },
    branchCount: { type: Number, default: 1, min: 1 },  // intended number of locations
    teamSize: { type: Number, default: 1, min: 1 },     // intended number of staff seats
  },

  // --- 2. BUSINESS BRANDING & LOCATION (Step 1 Update) ---
  businessName: { 
    type: String, 
    required: true 
  },
  category: { 
    type: String, 
    required: true, 
    enum: [
      "Beauty & Barbers",
      "Health & Medical",
      "Fitness & Gyms",
      "Creative & Media",
      "Car Services",
      "Maintenance",
      "Coaching & Tutors",
      "Consultants",
      "Events & DJs",
      "Grooming & Vets"
    ] 
  },
  ville: { 
    type: String, 
    required: true, 
    enum: [
      "Ariana", "Beja", "Ben Arous", "Bizerte", "Gabes", "Gafsa", 
      "Jendouba", "Kairouan", "Kasserine", "Kebili", "Kef", "Mahdia", 
      "Manouba", "Medenine", "Monastir", "Nabeul", "Sfax", "Sidi Bouzid", 
      "Siliana", "Sousse", "Tataouine", "Tozeur", "Tunis", "Zaghouan"
    ],
    alias: 'city' 
  },
  profilePicUrl: { 
    type: String 
  },

  // --- 3. BUSINESS LINKING (The Profile ID) ---
  profileId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'BusinessProfile',
    default: function() { return new mongoose.Types.ObjectId(); } 
  },

  // --- 4. VERIFICATION & SECURITY (Step 2 & 4) ---
  isEmailVerified: { type: Boolean, default: false },
  isPhoneVerified: { type: Boolean, default: false },
  
  // OTP codes for verification logic
  otpCodes: {
    phone: String,
    email: String,
    expiresAt: Date
  },

  // KYC (Know Your Customer) Tags
  kyc: {
    status: { 
      type: String, 
      enum: ['pending', 'verified', 'rejected', 'none'], 
      default: 'none' 
    },
    idFrontUrl: { type: String },
    idBackUrl: { type: String },
    livePhotoUrl: { type: String },
    verifiedAt: { type: Date },
    rejectionReason: { type: String }
  },

  // --- 5. ONBOARDING TRACKER (New Update) ---
  onboardingStep: {
    type: Number,
    default: 1, // 1: Global, 2: OTP, 3: Password, 4: KYC, 5: Completed
    enum: [1, 2, 3, 4, 5]
  },

  // --- 6. PAYMENT & SUBSCRIPTION TAGS ---
  paymentInfo: {
    walletAddress: { type: String }, 
    merchantId: { type: String },    
    currency: { type: String, default: 'TND' },
    
    subscription: {
      plan: { 
        type: String, 
        enum: ['free_trial', 'basic', 'premium', 'pro'], 
        default: 'free_trial' 
      },
      status: { 
        type: String, 
        enum: ['active', 'past_due', 'canceled', 'trialing'], 
        default: 'trialing' 
      },
      trialEndsAt: { 
        type: Date, 
        default: () => new Date(+new Date() + 90*24*60*60*1000) 
      },
      lastPaymentDate: { type: Date },
      nextBillingDate: { type: Date }
    },
    
    transactionHistory: [{
      transactionId: String,
      amount: Number,
      date: Date,
      status: String
    }]
  },

  // --- 7. APP SETTINGS & METADATA ---
  accountStatus: {
    type: String,
    enum: ['active', 'suspended', 'on_boarding', 'pending_kyc', 'review', 'rejected'],
    default: 'pending_kyc'
  },
  lastLogin: { type: Date },
  fcmToken: { type: String }, 

  // --- 8. ADVANCED SECURITY & TOKEN ROTATION (New Vault) ---
  refreshTokens: [{
    tokenHash: { type: String },
    // Legacy fallback for previously stored plaintext tokens (kept for migration safety).
    token: { type: String },
    deviceId: { type: String, required: true }, // From createDeviceFingerprint
    lastKnownIp: { type: String },
    expiresAt: { type: Date, required: true },
    createdAt: { type: Date, default: Date.now }
  }],

  // --- 9. WORK MODE: Worker invite link rotation ---
  workModeInviteNonce: { type: Number, default: 0 },

  // --- 9b. PASSWORD RESET ---
  passwordResetToken:   { type: String, select: false },
  passwordResetExpires: { type: Date,   select: false },

  // --- 9c. TWO-FACTOR AUTHENTICATION (TOTP) ---
  twoFactor: {
    enabled: { type: Boolean, default: false },
    secret:  { type: String,  select: false },
  },

  // --- 10. NOTIFICATION PREFERENCES ---
  notificationPrefs: {
    newBookingEmail: { type: Boolean, default: true },
    cancellationEmail: { type: Boolean, default: true },
  },

  // --- 11. BOOKING / DEPOSIT POLICY (no-show protection via prepaid deposit) ---
  bookingPolicy: {
    depositEnabled: { type: Boolean, default: false },
    depositType:    { type: String, enum: ['fixed', 'percent'], default: 'fixed' },
    depositValue:   { type: Number, default: 0, min: 0 },   // TND if fixed, % if percent
    provider:       { type: String, enum: ['flouci', 'konnect'], default: 'flouci' },
  },

}, { 
  timestamps: true 
});

UserSchema.virtual('isTrialActive').get(function() {
  return this.paymentInfo.subscription.trialEndsAt > Date.now();
});

UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });

const User = mongoose.model('User', UserSchema);
export default User;
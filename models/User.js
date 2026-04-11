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
    enum: ['owner', 'admin', 'customer'], 
    default: 'owner' 
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
      "Ariana",
    "Beja",
    "Ben Arous",
    "Bizerte",
    "Gabes",
    "Gafsa",
    "Jendouba",
    "Kairouan",
    "Kasserine",
    "Kebili",
    "Kef",
    "Mahdia",
    "Manouba",
    "Medenine",
    "Monastir",
    "Nabeul",
    "Sfax",
    "Sidi Bouzid",
    "Siliana",
    "Sousse",
    "Tataouine",
    "Tozeur",
    "Tunis",
    "Zaghouan"
    ],
    alias: 'city' // Maps to your React formData.city
  },
  profilePicUrl: { 
    type: String // URL from Cloudinary or S3 for business image
  },

  // --- 3. BUSINESS LINKING (The Profile ID) ---
  profileId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'BusinessProfile',
    default: function() { return new mongoose.Types.ObjectId(); } // Auto-generate on creation
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

  // --- 5. PAYMENT & SUBSCRIPTION TAGS ---
  paymentInfo: {
    // For Tunisia: Flouci / Konnect / Stripe integration tags
    walletAddress: { type: String }, // e.g., for Flouci integration
    merchantId: { type: String },    // For routing payments to the specific owner
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
        default: () => new Date(+new Date() + 90*24*60*60*1000) // Default 3-month trial
      },
      lastPaymentDate: { type: Date },
      nextBillingDate: { type: Date }
    },
    
    // History of transactions
    transactionHistory: [{
      transactionId: String,
      amount: Number,
      date: Date,
      status: String
    }]
  },

  // --- 6. APP SETTINGS & METADATA ---
  accountStatus: { 
    type: String, 
    enum: ['active', 'suspended', 'on_boarding', 'review'], 
    default: 'on_boarding' 
  },
  lastLogin: { type: Date },
  fcmToken: { type: String }, // For push notifications
  
}, { 
  timestamps: true // Automatically creates createdAt and updatedAt
});

// Virtual for easy checking if the user is currently in trial
UserSchema.virtual('isTrialActive').get(function() {
  return this.paymentInfo.subscription.trialEndsAt > Date.now();
});

// Ensure virtuals are included when converting to JSON
UserSchema.set('toJSON', { virtuals: true });
UserSchema.set('toObject', { virtuals: true });
const User = mongoose.model('User', UserSchema); // ✅ ADD THIS
export default User;
import mongoose from 'mongoose';

const DiscountCodeSchema = new mongoose.Schema({
  code:       { type: String, required: true, uppercase: true, trim: true },
  type:       { type: String, enum: ['fixed', 'percent'], required: true },
  value:      { type: Number, required: true, min: 0 },
  maxUses:    { type: Number, default: 0 }, // 0 = unlimited
  usedCount:  { type: Number, default: 0 },
  expiresAt:  { type: Date, default: null },
  isActive:   { type: Boolean, default: true },
  description:{ type: String, default: '', maxlength: 200, trim: true },
  createdAt:  { type: Date, default: Date.now },
});

const LoyaltyProgramSchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    unique: true,
    index: true,
  },
  isActive: { type: Boolean, default: false },

  // --- POINTS MODE ---
  mode: {
    type: String,
    enum: ['points', 'stamps'],
    default: 'points',
  },
  pointsPerBooking: { type: Number, default: 10, min: 1 },
  pointsToRedeem:   { type: Number, default: 100, min: 1 },
  rewardValue:      { type: Number, default: 5, min: 0 },
  rewardType:       { type: String, enum: ['fixed', 'percent'], default: 'fixed' },

  // --- STAMPS MODE ---
  stampsNeeded: { type: Number, default: 10, min: 2 },
  stampReward:  { type: String, default: 'Free service of your choice', maxlength: 200, trim: true },

  // --- DISCOUNT CODES ---
  discountCodes: [DiscountCodeSchema],

  programName:   { type: String, default: 'Loyalty Rewards', maxlength: 100, trim: true },
  programDescription: { type: String, default: '', maxlength: 500, trim: true },

}, { timestamps: true });

const LoyaltyProgram = mongoose.model('LoyaltyProgram', LoyaltyProgramSchema);
export default LoyaltyProgram;

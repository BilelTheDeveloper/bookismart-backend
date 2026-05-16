import mongoose from 'mongoose';

const RedemptionSchema = new mongoose.Schema({
  type:      { type: String, enum: ['points', 'stamps', 'discount_code'], required: true },
  amount:    { type: Number, default: 0 },
  reward:    { type: String, default: '' },
  redeemedAt:{ type: Date, default: Date.now },
}, { _id: false });

const CustomerLoyaltySchema = new mongoose.Schema({
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },
  customerEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true,
  },
  customerPhone: { type: String, default: '', trim: true },
  customerName:  { type: String, default: 'Customer', trim: true },

  points:      { type: Number, default: 0, min: 0 },
  stamps:      { type: Number, default: 0, min: 0 },
  totalVisits: { type: Number, default: 0, min: 0 },
  totalSpend:  { type: Number, default: 0, min: 0 },
  lastVisitAt: { type: Date, default: null },

  redemptions: [RedemptionSchema],
}, { timestamps: true });

CustomerLoyaltySchema.index({ ownerId: 1, customerEmail: 1 }, { unique: true });

const CustomerLoyalty = mongoose.model('CustomerLoyalty', CustomerLoyaltySchema);
export default CustomerLoyalty;

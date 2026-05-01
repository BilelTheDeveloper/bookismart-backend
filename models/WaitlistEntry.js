import mongoose from 'mongoose';

const WaitlistEntrySchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },

    dateString: { type: String, required: true, index: true }, // yyyy-mm-dd
    timeSlot: { type: String, required: true, index: true }, // HH:mm
    serviceTitle: { type: String, default: '' },
    serviceDuration: { type: Number, default: 30 },

    customerName: { type: String, required: true, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    customerPhone: { type: String, trim: true },

    status: { type: String, enum: ['waiting', 'offered', 'accepted', 'expired', 'cancelled'], default: 'waiting', index: true },
    offerToken: { type: String, default: '', index: true },
    offerExpiresAt: { type: Date, default: null, index: true },
  },
  { timestamps: true }
);

WaitlistEntrySchema.index({ ownerId: 1, dateString: 1, timeSlot: 1, status: 1, createdAt: 1 });

const WaitlistEntry = mongoose.model('WaitlistEntry', WaitlistEntrySchema);
export default WaitlistEntry;


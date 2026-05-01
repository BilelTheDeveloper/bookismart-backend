import mongoose from 'mongoose';

const ReviewSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true },

    customerName: { type: String, required: true, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    customerPhone: { type: String, trim: true },

    rating: { type: Number, required: true, min: 1, max: 5 },
    text: { type: String, default: '', trim: true, maxlength: 1200 },

    status: { type: String, enum: ['published', 'hidden'], default: 'published', index: true },
  },
  { timestamps: true }
);

ReviewSchema.index({ ownerId: 1, status: 1, createdAt: -1 });

const Review = mongoose.model('Review', ReviewSchema);
export default Review;


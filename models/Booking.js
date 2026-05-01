import mongoose from 'mongoose';

const BookingSchema = new mongoose.Schema({
  // 1. RELATIONSHIPS
  ownerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Links to the Business Owner
    required: true,
    index: true // Optimized for Dashboard queries
  },
  merchantId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Merchant', // Links to the specific shop profile
    required: true
  },

  // 2. CUSTOMER INFORMATION
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  customerEmail: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  customerPhone: {
    type: String,
    required: true
  },

  // 3. APPOINTMENT DETAILS
  service: {
    title: { type: String, required: true },
    price: { type: String, required: true }, // Snapshotted price at time of booking
    duration: { type: Number } // Duration in minutes
  },
  
  // 4. DATE & TIME (Split for easy filtering in Dashboard)
  appointmentDate: {
    type: Date, // The full JS Date object
    required: true
  },
  dateString: { 
    type: String, 
    required: true // e.g., "2026-04-15" (Easy for owner to filter by day)
  },
  timeSlot: { 
    type: String, 
    required: true // e.g., "14:30"
  },
  dayOfWeek: {
    type: String, // e.g., "Monday"
    enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
  },

  // 5. STATUS & MANAGEMENT
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'completed', 'cancelled', 'no-show'],
    default: 'pending'
  },
  notes: {
    type: String,
    maxLength: 500
  },

  // 7. AUTOMATION & LINKS (Reminders / Reviews / Waitlist)
  reminder24hSentAt: { type: Date, default: null },
  reminder2hSentAt: { type: Date, default: null },
  reminderLastError: { type: String, default: '' },

  reviewToken: { type: String, default: '', index: true },
  reviewInviteSentAt: { type: Date, default: null },
  reviewSubmittedAt: { type: Date, default: null },
  
  // 6. METADATA
  createdAt: {
    type: Date,
    default: Date.now
  }
}, { timestamps: true });

// Create an index to prevent double bookings for the same owner at the same time
BookingSchema.index({ ownerId: 1, dateString: 1, timeSlot: 1 }, { unique: true });

// 🛡️ FIX: Create the model constant
const Booking = mongoose.model('Booking', BookingSchema);

// 🛡️ FIX: Use export default instead of module.exports
export default Booking;
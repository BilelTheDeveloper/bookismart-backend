import mongoose from 'mongoose';

const ConsultationMessageSchema = new mongoose.Schema(
  {
    // Back-compat: keep 'moderator' for existing records, but new UI uses 'worker'
    senderRole: { type: String, enum: ['owner', 'worker', 'moderator'], required: true },
    senderId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    text: { type: String, required: true, trim: true, maxlength: 1500 },
  },
  { _id: true, timestamps: true }
);

const ConsultationSchema = new mongoose.Schema(
  {
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    moderatorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    bookingId: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true },

    customerName: { type: String, required: true, trim: true },
    customerEmail: { type: String, trim: true, lowercase: true },
    customerPhone: { type: String, trim: true },

    serviceTitle: { type: String, required: true },
    servicePrice: { type: String, default: '' },
    serviceDurationMinutes: { type: Number, required: true, min: 5, max: 480 },

    dateString: { type: String, required: true },
    timeSlot: { type: String, required: true },

    status: {
      type: String,
      enum: ['waiting', 'in_progress', 'done', 'cancelled'],
      default: 'waiting',
      index: true,
    },
    initialSeconds: { type: Number, required: true, min: 60 },
    remainingSeconds: { type: Number, required: true, min: 0 },

    ownerNotes: { type: String, default: '', maxlength: 1000 },
    // Back-compat: previously used for moderator notes; now mapped to worker notes
    moderatorNotes: { type: String, default: '', maxlength: 1000 },
    completionSummary: { type: String, default: '', maxlength: 1200 },

    startedAt: { type: Date, default: Date.now },
    endedAt: { type: Date, default: null },
    lastActivityAt: { type: Date, default: Date.now },

    messages: [ConsultationMessageSchema],
  },
  { timestamps: true }
);

ConsultationSchema.index({ ownerId: 1, status: 1, updatedAt: -1 });
ConsultationSchema.index({ status: 1, updatedAt: -1 });
ConsultationSchema.index({ customerEmail: 1, ownerId: 1, createdAt: -1 });
ConsultationSchema.index({ customerPhone: 1, ownerId: 1, createdAt: -1 });

const Consultation = mongoose.model('Consultation', ConsultationSchema);
export default Consultation;

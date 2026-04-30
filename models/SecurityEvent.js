import mongoose from 'mongoose';

const SecurityEventSchema = new mongoose.Schema(
  {
    level: { type: String, enum: ['SECURITY', 'WARN', 'ERROR', 'INFO'], default: 'SECURITY', index: true },
    msg: { type: String, required: true, maxlength: 400 },

    // Optional context
    code: { type: String, default: '' }, // e.g. TOKEN_REVOKED, FINGERPRINT_MISMATCH, RATE_LIMIT
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null, index: true },
    ip: { type: String, default: '' },
    path: { type: String, default: '' },
    method: { type: String, default: '' },

    meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

SecurityEventSchema.index({ createdAt: -1 });

const SecurityEvent = mongoose.model('SecurityEvent', SecurityEventSchema);
export default SecurityEvent;


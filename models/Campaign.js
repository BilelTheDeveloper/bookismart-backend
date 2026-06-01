import mongoose from 'mongoose';

/**
 * Campaign — a marketing broadcast an owner sent to a customer segment.
 * Stored for history; actual delivery via messageProviders + emailService.
 */
const CampaignSchema = new mongoose.Schema({
  ownerId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  segment:        { type: String, enum: ['all', 'inactive', 'recent'], default: 'all' },
  subject:        { type: String, default: '' },
  message:        { type: String, default: '', maxlength: 1000 },
  channels:       { whatsapp: { type: Boolean, default: false }, email: { type: Boolean, default: true } },
  recipientCount: { type: Number, default: 0 },
  sentWhatsApp:   { type: Number, default: 0 },
  sentEmail:      { type: Number, default: 0 },
}, { timestamps: true });

CampaignSchema.index({ ownerId: 1, createdAt: -1 });

export default mongoose.model('Campaign', CampaignSchema);

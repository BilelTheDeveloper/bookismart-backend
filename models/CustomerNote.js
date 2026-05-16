import mongoose from 'mongoose';

const ProfileNoteSchema = new mongoose.Schema({
  text:  { type: String, required: true, maxlength: 600, trim: true },
  tag:   { type: String, enum: ['general', 'vip', 'allergy', 'preference', 'warning'], default: 'general' },
  createdAt: { type: Date, default: Date.now },
}, { _id: true });

const CheckpointSchema = new mongoose.Schema({
  consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation' },
  date:       { type: String, required: true },   // dateString e.g. "2026-05-16"
  service:    { type: String, default: '' },
  summary:    { type: String, default: '', maxlength: 800, trim: true },
  nextAction: { type: String, default: '', maxlength: 400, trim: true },
  createdAt:  { type: Date, default: Date.now },
}, { _id: true });

const CustomerNoteSchema = new mongoose.Schema({
  ownerId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  customerEmail: { type: String, lowercase: true, trim: true, default: '' },
  customerPhone: { type: String, trim: true, default: '' },
  customerName:  { type: String, trim: true, default: '' },

  profileNotes: { type: [ProfileNoteSchema], default: [] },
  checkpoints:  { type: [CheckpointSchema],  default: [] },
}, { timestamps: true });

CustomerNoteSchema.index({ ownerId: 1, customerEmail: 1 });
CustomerNoteSchema.index({ ownerId: 1, customerPhone: 1 });

export default mongoose.model('CustomerNote', CustomerNoteSchema);

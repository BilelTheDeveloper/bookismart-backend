import mongoose from 'mongoose';

const NotificationSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  type:    { type: String, enum: ['booking', 'application', 'review', 'system', 'payment', 'chat', 'staff', 'customer'], default: 'system' },
  title:   { type: String, required: true, maxlength: 200 },
  body:    { type: String, default: '', maxlength: 500 },
  link:    { type: String, default: '' },
  read:    { type: Boolean, default: false, index: true },
  meta:    { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

NotificationSchema.index({ userId: 1, read: 1, createdAt: -1 });

export default mongoose.model('Notification', NotificationSchema);

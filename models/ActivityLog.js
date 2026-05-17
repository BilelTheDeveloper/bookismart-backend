import mongoose from 'mongoose';

const ActivityLogSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  action:    { type: String, required: true }, // e.g. 'LOGIN_SUCCESS', 'LOGOUT', 'PASSWORD_CHANGE'
  ip:        { type: String, default: 'unknown' },
  userAgent: { type: String, default: '' },
  success:   { type: Boolean, default: true },
  meta:      { type: Object, default: {} },
}, { timestamps: true });

// Auto-delete logs older than 90 days
ActivityLogSchema.index({ createdAt: 1 }, { expireAfterSeconds: 90 * 24 * 60 * 60 });

const ActivityLog = mongoose.model('ActivityLog', ActivityLogSchema);
export default ActivityLog;

import mongoose from 'mongoose';

const ScheduleSlotSchema = new mongoose.Schema({
  day:   { type: String, enum: ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'], required: true },
  start: { type: String, default: '09:00' },
  end:   { type: String, default: '17:00' },
  isOff: { type: Boolean, default: false },
}, { _id: false });

const StaffSchema = new mongoose.Schema({
  ownerId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  fullName:    { type: String, required: true, trim: true },
  email:       { type: String, required: true, lowercase: true, trim: true },
  phone:       { type: String, default: '' },
  role:        { type: String, enum: ['manager', 'staff', 'receptionist'], default: 'staff' },
  profilePic:  { type: String, default: '' },
  skills:      [{ type: String, trim: true }],
  schedule:    [ScheduleSlotSchema],
  status:      { type: String, enum: ['invited', 'active', 'inactive'], default: 'invited' },
  inviteToken: { type: String, default: '' },
  notes:       { type: String, default: '', maxlength: 1000 },
}, { timestamps: true });

StaffSchema.index({ ownerId: 1, status: 1 });
StaffSchema.index({ ownerId: 1, email: 1 }, { unique: true });

export default mongoose.model('Staff', StaffSchema);

import mongoose from 'mongoose';

const JobPostSchema = new mongoose.Schema({
  ownerId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  businessName:    { type: String, required: true },
  title:           { type: String, required: true, trim: true, maxlength: 120 },
  description:     { type: String, required: true, maxlength: 5000 },
  skills:          [{ type: String, trim: true }],
  jobType:         { type: String, enum: ['full-time', 'part-time', 'freelance', 'internship'], required: true },
  salaryMin:       { type: Number, default: null },
  salaryMax:       { type: Number, default: null },
  salaryCurrency:  { type: String, default: 'USD' },
  location:        { type: String, default: '' },
  isRemote:        { type: Boolean, default: false },
  deadline:        { type: Date, default: null },
  status:          { type: String, enum: ['draft', 'pending_review', 'approved', 'rejected', 'closed'], default: 'draft' },
  rejectionReason: { type: String, default: '' },
}, { timestamps: true });

JobPostSchema.index({ ownerId: 1, status: 1 });
JobPostSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('JobPost', JobPostSchema);

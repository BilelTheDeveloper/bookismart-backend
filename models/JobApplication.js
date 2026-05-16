import mongoose from 'mongoose';

const JobApplicationSchema = new mongoose.Schema({
  jobId:           { type: mongoose.Schema.Types.ObjectId, ref: 'JobPost', required: true },
  ownerId:         { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  applicantName:   { type: String, required: true, trim: true },
  applicantEmail:  { type: String, required: true, lowercase: true, trim: true },
  applicantPhone:  { type: String, required: true, trim: true },
  coverLetter:     { type: String, required: true, maxlength: 3000 },
  cvUrl:           { type: String, required: true },
  status:          { type: String, enum: ['pending', 'shortlisted', 'accepted', 'rejected'], default: 'pending' },
  ownerNotes:      { type: String, default: '' },
  rejectionReason: { type: String, default: '' },
}, { timestamps: true });

// One application per email per job
JobApplicationSchema.index({ jobId: 1, applicantEmail: 1 }, { unique: true });
JobApplicationSchema.index({ ownerId: 1, status: 1 });
JobApplicationSchema.index({ jobId: 1, createdAt: -1 });

export default mongoose.model('JobApplication', JobApplicationSchema);

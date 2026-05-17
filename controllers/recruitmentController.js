import { v2 as cloudinary } from 'cloudinary';
import JobPost from '../models/JobPost.js';
import JobApplication from '../models/JobApplication.js';
import User from '../models/User.js';
import { sendEmail } from '../utils/emailService.js';

const sendMail = async (to, subject, html) => {
  try { await sendEmail({ to, subject, html }); } catch { /* non-blocking */ }
};

/* ─── Cloudinary helpers ─── */
const uploadBase64Image = async (dataUrl, folder) => {
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
    transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
  });
  return result.secure_url;
};

const uploadBase64PDF = async (dataUrl, folder) => {
  const result = await cloudinary.uploader.upload(dataUrl, { folder, resource_type: 'raw' });
  return result.secure_url;
};

/* ─── Email Templates ─── */
const emailJobApproved = (owner, job) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">Job Post Approved ✅</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${owner.fullName}</strong>,</p>
    <p>Your job post has been approved and is now live on the public recruitment page.</p>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0;font-weight:bold;color:#a5b4fc;">📋 ${job.title}</p>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:14px;">${job.jobType} · ${job.location || 'Remote'}</p>
    </div>
    <p>Candidates can now find and apply for this position.</p>
    <a href="${process.env.CLIENT_URL}/owner/dashboard/recruitment" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;margin-top:8px;">View Applications</a>
  </div>
</div>`;

const emailJobRejected = (owner, job, reason) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">Job Post Rejected</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${owner.fullName}</strong>,</p>
    <p>Your job post <strong>"${job.title}"</strong> could not be approved at this time.</p>
    ${reason ? `<div style="background:#1e293b;border-left:4px solid #dc2626;border-radius:8px;padding:16px;margin:20px 0;"><p style="margin:0;color:#fca5a5;">Reason: ${reason}</p></div>` : ''}
    <p>You can edit your post and resubmit for review from your dashboard.</p>
    <a href="${process.env.CLIENT_URL}/owner/dashboard/recruitment" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;margin-top:8px;">Edit Post</a>
  </div>
</div>`;

const emailApplicationConfirm = (app, job, business) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#059669,#047857);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">Application Received ✅</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${app.applicantName}</strong>,</p>
    <p>Your application has been successfully submitted.</p>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0;font-weight:bold;color:#a5b4fc;">📋 ${job.title}</p>
      <p style="margin:6px 0 0;color:#94a3b8;font-size:14px;">${business}</p>
    </div>
    <p>The employer will review your application and reach out if you are shortlisted. Good luck!</p>
  </div>
</div>`;

const emailNewApplication = (owner, app, job) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">New Application 📬</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${owner.fullName}</strong>,</p>
    <p>Someone just applied for your job post.</p>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0;font-weight:bold;color:#a5b4fc;">📋 ${job.title}</p>
      <p style="margin:8px 0 0;"><strong>Applicant:</strong> ${app.applicantName}</p>
      <p style="margin:4px 0;"><strong>Email:</strong> ${app.applicantEmail}</p>
      <p style="margin:4px 0;"><strong>Phone:</strong> ${app.applicantPhone}</p>
    </div>
    <a href="${process.env.CLIENT_URL}/owner/dashboard/recruitment" style="display:inline-block;background:#4f46e5;color:#fff;padding:12px 28px;border-radius:10px;text-decoration:none;font-weight:bold;margin-top:8px;">Review Application</a>
  </div>
</div>`;

const emailApplicantAccepted = (app, job, business) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#059669,#047857);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">Congratulations! 🎉</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${app.applicantName}</strong>,</p>
    <p>We are pleased to inform you that your application for <strong>"${job.title}"</strong> at <strong>${business}</strong> has been <span style="color:#34d399;font-weight:bold;">accepted</span>.</p>
    <p>The employer will be in touch with next steps. Congratulations again!</p>
  </div>
</div>`;

const emailApplicantRejected = (app, job, business, reason) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#64748b,#475569);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:24px;">Application Update</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${app.applicantName}</strong>,</p>
    <p>Thank you for applying for <strong>"${job.title}"</strong> at <strong>${business}</strong>.</p>
    <p>After careful consideration, we will not be moving forward with your application at this time.</p>
    ${reason ? `<div style="background:#1e293b;border-radius:8px;padding:16px;margin:16px 0;"><p style="margin:0;color:#94a3b8;font-size:14px;">${reason}</p></div>` : ''}
    <p>We wish you the best in your job search.</p>
  </div>
</div>`;

/* ══════════════════════════════════════════════════════════
   PUBLIC ENDPOINTS
══════════════════════════════════════════════════════════ */

export const getPublicJobs = async (req, res) => {
  try {
    const { jobType, search, page = 1, limit = 12 } = req.query;
    const filter = { status: 'approved' };

    if (jobType && ['full-time', 'part-time', 'freelance', 'internship'].includes(jobType)) {
      filter.jobType = jobType;
    }
    if (search) {
      const re = new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ title: re }, { description: re }, { skills: re }, { businessName: re }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [jobs, total] = await Promise.all([
      JobPost.find(filter)
        .select('-rejectionReason -ownerId')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      JobPost.countDocuments(filter),
    ]);

    res.json({ success: true, jobs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getPublicJobById = async (req, res) => {
  try {
    const job = await JobPost.findOne({ _id: req.params.id, status: 'approved' })
      .select('-rejectionReason -ownerId')
      .lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found' });
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const applyToJob = async (req, res) => {
  try {
    const { applicantName, applicantEmail, applicantPhone, coverLetter, cvBase64 } = req.body;

    if (!applicantName || !applicantEmail || !applicantPhone || !coverLetter || !cvBase64) {
      return res.status(400).json({ success: false, message: 'All fields including CV are required.' });
    }

    const job = await JobPost.findOne({ _id: req.params.id, status: 'approved' });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found or no longer accepting applications.' });

    if (job.deadline && new Date() > new Date(job.deadline)) {
      return res.status(400).json({ success: false, message: 'Application deadline has passed.' });
    }

    // Check duplicate
    const existing = await JobApplication.findOne({ jobId: job._id, applicantEmail: applicantEmail.toLowerCase() });
    if (existing) {
      return res.status(409).json({ success: false, message: 'You have already applied for this position.' });
    }

    // Upload CV (PDF)
    if (!cvBase64.startsWith('data:')) {
      return res.status(400).json({ success: false, message: 'Invalid CV format.' });
    }
    const cvUrl = await uploadBase64PDF(cvBase64, 'bookiify/cvs');

    const application = await JobApplication.create({
      jobId: job._id,
      ownerId: job.ownerId,
      applicantName,
      applicantEmail,
      applicantPhone,
      coverLetter,
      cvUrl,
    });

    const owner = await User.findById(job.ownerId).select('fullName email notificationPrefs').lean();

    // Emails (non-blocking)
    sendMail(applicantEmail, `Application Received — ${job.title}`, emailApplicationConfirm(application, job, job.businessName));
    if (owner?.email) {
      sendMail(owner.email, `New Application for "${job.title}"`, emailNewApplication(owner, application, job));
    }

    res.status(201).json({ success: true, message: 'Application submitted successfully.' });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'You have already applied for this position.' });
    }
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ══════════════════════════════════════════════════════════
   OWNER ENDPOINTS
══════════════════════════════════════════════════════════ */

export const createJob = async (req, res) => {
  try {
    const { title, description, skills, jobType, salaryMin, salaryMax, salaryCurrency, location, isRemote, deadline } = req.body;

    if (!title || !description || !jobType) {
      return res.status(400).json({ success: false, message: 'Title, description and job type are required.' });
    }

    const job = await JobPost.create({
      ownerId: req.user._id,
      businessName: req.user.businessName || 'My Business',
      title,
      description,
      skills: Array.isArray(skills) ? skills.filter(Boolean) : [],
      jobType,
      salaryMin: salaryMin || null,
      salaryMax: salaryMax || null,
      salaryCurrency: salaryCurrency || 'USD',
      location: location || '',
      isRemote: !!isRemote,
      deadline: deadline || null,
      status: 'draft',
    });

    res.status(201).json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getOwnerJobs = async (req, res) => {
  try {
    const jobs = await JobPost.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).lean();

    const jobIds = jobs.map(j => j._id);
    const counts = await JobApplication.aggregate([
      { $match: { jobId: { $in: jobIds } } },
      { $group: { _id: '$jobId', count: { $sum: 1 } } },
    ]);
    const countMap = {};
    counts.forEach(c => { countMap[c._id.toString()] = c.count; });

    const result = jobs.map(j => ({ ...j, applicationCount: countMap[j._id.toString()] || 0 }));
    res.json({ success: true, jobs: result });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateJob = async (req, res) => {
  try {
    const job = await JobPost.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
    if (!['draft', 'rejected'].includes(job.status)) {
      return res.status(400).json({ success: false, message: 'Only draft or rejected posts can be edited.' });
    }

    const fields = ['title', 'description', 'skills', 'jobType', 'salaryMin', 'salaryMax', 'salaryCurrency', 'location', 'isRemote', 'deadline'];
    fields.forEach(f => { if (req.body[f] !== undefined) job[f] = req.body[f]; });
    // Reset to draft if rejected and user edits
    if (job.status === 'rejected') { job.status = 'draft'; job.rejectionReason = ''; }
    await job.save();

    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteJob = async (req, res) => {
  try {
    const job = await JobPost.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
    if (!['draft', 'rejected'].includes(job.status)) {
      return res.status(400).json({ success: false, message: 'Only draft or rejected posts can be deleted.' });
    }
    await job.deleteOne();
    res.json({ success: true, message: 'Job post deleted.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const submitJob = async (req, res) => {
  try {
    const job = await JobPost.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
    if (!['draft', 'rejected'].includes(job.status)) {
      return res.status(400).json({ success: false, message: 'Only draft posts can be submitted for review.' });
    }
    job.status = 'pending_review';
    job.rejectionReason = '';
    await job.save();
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const closeJob = async (req, res) => {
  try {
    const job = await JobPost.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });
    if (job.status !== 'approved') {
      return res.status(400).json({ success: false, message: 'Only approved posts can be closed.' });
    }
    job.status = 'closed';
    await job.save();
    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getJobApplications = async (req, res) => {
  try {
    const job = await JobPost.findOne({ _id: req.params.id, ownerId: req.user._id }).lean();
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    const applications = await JobApplication.find({ jobId: job._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, job, applications });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateApplicationStatus = async (req, res) => {
  try {
    const { status, ownerNotes, rejectionReason } = req.body;
    const validStatuses = ['pending', 'shortlisted', 'accepted', 'rejected'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({ success: false, message: 'Invalid status.' });
    }

    const app = await JobApplication.findOne({ _id: req.params.appId, ownerId: req.user._id });
    if (!app) return res.status(404).json({ success: false, message: 'Application not found.' });

    const prevStatus = app.status;
    app.status = status;
    if (ownerNotes !== undefined) app.ownerNotes = ownerNotes;
    if (status === 'rejected' && rejectionReason) app.rejectionReason = rejectionReason;
    await app.save();

    // Send emails on final decisions only
    if (prevStatus !== status) {
      const job = await JobPost.findById(app.jobId).lean();
      if (status === 'accepted') {
        sendMail(app.applicantEmail, `Your application has been accepted — ${job?.title}`, emailApplicantAccepted(app, job, app.ownerId));
      } else if (status === 'rejected') {
        sendMail(app.applicantEmail, `Application Update — ${job?.title}`, emailApplicantRejected(app, job, job?.businessName || 'the employer', rejectionReason));
      }
    }

    res.json({ success: true, application: app });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/* ══════════════════════════════════════════════════════════
   ADMIN ENDPOINTS
══════════════════════════════════════════════════════════ */

export const getAdminJobs = async (req, res) => {
  try {
    const { status = 'pending_review', page = 1, limit = 20 } = req.query;
    const filter = status === 'all' ? {} : { status };
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [jobs, total] = await Promise.all([
      JobPost.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      JobPost.countDocuments(filter),
    ]);

    res.json({ success: true, jobs, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const reviewJob = async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });
    }

    const job = await JobPost.findById(req.params.id);
    if (!job) return res.status(404).json({ success: false, message: 'Job not found.' });

    job.status = action === 'approve' ? 'approved' : 'rejected';
    if (action === 'reject') job.rejectionReason = reason || '';
    await job.save();

    const owner = await User.findById(job.ownerId).select('fullName email').lean();
    if (owner?.email) {
      if (action === 'approve') {
        sendMail(owner.email, `Your job post is now live — ${job.title}`, emailJobApproved(owner, job));
      } else {
        sendMail(owner.email, `Job post update — ${job.title}`, emailJobRejected(owner, job, reason));
      }
    }

    res.json({ success: true, job });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

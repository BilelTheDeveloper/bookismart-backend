import crypto from 'crypto';
import { v2 as cloudinary } from 'cloudinary';
import Staff from '../models/Staff.js';
import { sendEmail } from '../utils/emailService.js';

const sendMail = async (to, subject, html) => {
  try { await sendEmail({ to, subject, html }); } catch {}
};

const inviteEmailHtml = (staff, owner, token) => `
<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;background:#0f172a;color:#e2e8f0;border-radius:16px;overflow:hidden;">
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:32px 24px;text-align:center;">
    <h1 style="color:#fff;margin:0;font-size:22px;">You're Invited to Join the Team 🎉</h1>
  </div>
  <div style="padding:32px 24px;">
    <p>Hi <strong>${staff.fullName}</strong>,</p>
    <p><strong>${owner.businessName || owner.fullName}</strong> has added you as a team member on Bookiify.</p>
    <div style="background:#1e293b;border-radius:12px;padding:20px;margin:20px 0;">
      <p style="margin:0;color:#a5b4fc;font-weight:bold;">Role: ${staff.role.charAt(0).toUpperCase() + staff.role.slice(1)}</p>
    </div>
    <p>Your invitation token: <strong style="color:#a5b4fc;font-size:18px;letter-spacing:2px;">${token}</strong></p>
    <p style="color:#64748b;font-size:13px;">Use this token to access the work dashboard.</p>
  </div>
</div>`;

export const inviteStaff = async (req, res) => {
  try {
    const { fullName, email, phone, role, skills, notes } = req.body;
    if (!fullName || !email) return res.status(400).json({ success: false, message: 'Name and email are required.' });

    const token = crypto.randomBytes(6).toString('hex').toUpperCase();

    let profilePicUrl = '';
    if (req.body.profilePicBase64) {
      const result = await cloudinary.uploader.upload(req.body.profilePicBase64, {
        folder: 'bookiify/staff', resource_type: 'image',
        transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }],
      });
      profilePicUrl = result.secure_url;
    }

    const staff = await Staff.create({
      ownerId: req.user._id,
      fullName, email, phone: phone || '',
      role: role || 'staff',
      skills: Array.isArray(skills) ? skills.filter(Boolean) : [],
      notes: notes || '',
      profilePic: profilePicUrl,
      inviteToken: token,
      status: 'invited',
      schedule: ['monday','tuesday','wednesday','thursday','friday'].map(day => ({ day, start: '09:00', end: '17:00', isOff: false })),
    });

    sendMail(email, `You're invited to join ${req.user.businessName || 'Bookiify'}`, inviteEmailHtml(staff, req.user, token));

    res.status(201).json({ success: true, staff });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'A staff member with this email already exists.' });
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getStaff = async (req, res) => {
  try {
    const staff = await Staff.find({ ownerId: req.user._id }).sort({ createdAt: -1 }).lean();
    res.json({ success: true, staff });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const getStaffById = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id }).lean();
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    res.json({ success: true, staff: member });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const updateStaff = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });

    const fields = ['fullName', 'phone', 'role', 'skills', 'notes', 'schedule', 'status'];
    fields.forEach(f => { if (req.body[f] !== undefined) member[f] = req.body[f]; });

    if (req.body.profilePicBase64) {
      const result = await cloudinary.uploader.upload(req.body.profilePicBase64, {
        folder: 'bookiify/staff', resource_type: 'image',
        transformation: [{ width: 400, height: 400, crop: 'fill', quality: 'auto' }],
      });
      member.profilePic = result.secure_url;
    }

    await member.save();
    res.json({ success: true, staff: member });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const toggleStaffStatus = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    member.status = member.status === 'active' ? 'inactive' : 'active';
    await member.save();
    res.json({ success: true, staff: member });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const deleteStaff = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    await member.deleteOne();
    res.json({ success: true, message: 'Staff member removed.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

export const resendInvite = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    const token = crypto.randomBytes(6).toString('hex').toUpperCase();
    member.inviteToken = token;
    member.status = 'invited';
    await member.save();
    sendMail(member.email, `Your new invite token — ${req.user.businessName || 'Bookiify'}`, inviteEmailHtml(member, req.user, token));
    res.json({ success: true, message: 'Invite resent.' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
};

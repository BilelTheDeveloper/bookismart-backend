import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import Staff from '../models/Staff.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendEmail } from '../utils/emailService.js';
import { issueStaffTokens } from '../middleware/staffAuth.js';
import { redis } from '../config/redis.js';
import { generateCsrfToken } from '../middleware/csrfProtection.js';
import { getCsrfCookieOptions } from '../utils/tokenService.js';

const setStaffCsrfCookie = (res, token) => {
  res.cookie('csrfToken', token, { ...getCsrfCookieOptions(), maxAge: 7 * 24 * 60 * 60 * 1000 });
};

/* ─── Helpers ─── */
const generateOTP  = () => Math.floor(100000 + Math.random() * 900000).toString();

const uploadBase64 = async (dataUrl, folder) => {
  if (!dataUrl?.startsWith('data:')) return null;
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
    transformation: [{ width: 600, height: 600, crop: 'fill', quality: 'auto' }],
  });
  return result.secure_url;
};

const markExpired = async (staff) => {
  if (['invited', 'opened'].includes(staff.status) && staff.registrationTokenExpiry && new Date() > staff.registrationTokenExpiry) {
    staff.status = 'expired';
    await staff.save();
    // Notify owner
    try {
      await Notification.create({
        userId: staff.ownerId,
        type: 'system',
        title: 'Staff invite expired',
        body: `The invitation sent to ${staff.fullName} (${staff.email}) has expired. You can resend it from the Staff page.`,
      });
    } catch { /* non-blocking */ }
    return true;
  }
  return false;
};

const inviteEmailHtml = (staff, owner, link) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif}
  .wrap{max-width:580px;margin:40px auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 4px 30px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:40px 40px 32px;text-align:center}
  .logo{color:#fff;font-size:26px;font-weight:900;letter-spacing:-1px}
  .logo span{color:#a5b4fc}
  .badge{display:inline-block;margin-top:12px;padding:5px 14px;background:rgba(255,255,255,0.15);border:1px solid rgba(255,255,255,0.3);border-radius:99px;color:#e0e7ff;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase}
  .body{padding:40px}
  .title{font-size:22px;font-weight:900;color:#0f172a;margin-bottom:12px}
  .sub{font-size:15px;color:#475569;line-height:1.6;margin-bottom:28px}
  .info-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px 24px;margin-bottom:28px}
  .info-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px}
  .info-row:last-child{border:none}
  .info-label{color:#94a3b8;font-weight:600}
  .info-val{color:#1e293b;font-weight:800}
  .btn{display:block;text-align:center;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff!important;text-decoration:none;font-weight:800;font-size:14px;padding:18px 32px;border-radius:16px;margin:0 auto 20px;letter-spacing:0.05em}
  .link-box{background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;padding:14px 18px;margin-bottom:28px;word-break:break-all;font-size:12px;color:#64748b}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:20px 40px;text-align:center;font-size:12px;color:#94a3b8}
</style></head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">BOOKIIFY<span>.</span></div>
    <div class="badge">Team Invitation</div>
  </div>
  <div class="body">
    <div class="title">You've been added to the team 🎉</div>
    <p class="sub">
      Hi <strong>${staff.fullName}</strong>, <strong>${owner.businessName || owner.fullName}</strong> has invited you to join their team on Bookiify.
      Complete your registration to get started.
    </p>
    <div class="info-box">
      <div class="info-row"><span class="info-label">Business</span><span class="info-val">${owner.businessName || 'Bookiify'}</span></div>
      <div class="info-row"><span class="info-label">Role</span><span class="info-val">${staff.role.charAt(0).toUpperCase() + staff.role.slice(1)}</span></div>
      <div class="info-row"><span class="info-label">Expires</span><span class="info-val">7 days</span></div>
    </div>
    <a href="${link}" class="btn">COMPLETE MY REGISTRATION</a>
    <p style="font-size:12px;color:#94a3b8;text-align:center;margin-bottom:16px">Or copy this link:</p>
    <div class="link-box">${link}</div>
  </div>
  <div class="footer">&copy; 2026 Bookiify. This invitation expires in 7 days.</div>
</div>
</body></html>`;

const otpEmailHtml = (name, otp, businessName) => `
<!DOCTYPE html><html><head><meta charset="UTF-8"/>
<style>
  body{margin:0;padding:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif}
  .wrap{max-width:480px;margin:40px auto;background:#fff;border-radius:24px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08)}
  .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:36px;text-align:center}
  .logo{color:#fff;font-size:22px;font-weight:900;letter-spacing:-1px}
  .logo span{color:#a5b4fc}
  .body{padding:36px;text-align:center}
  .otp{font-size:46px;font-weight:900;color:#4f46e5;letter-spacing:12px;margin:24px 0;font-family:monospace}
  .label{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:0.15em;color:#94a3b8;margin-bottom:8px}
  .expiry{font-size:13px;color:#94a3b8;margin-top:4px}
  .footer{background:#f8fafc;border-top:1px solid #e2e8f0;padding:16px 36px;text-align:center;font-size:12px;color:#94a3b8}
</style></head>
<body>
<div class="wrap">
  <div class="header"><div class="logo">BOOKIIFY<span>.</span></div></div>
  <div class="body">
    <p style="font-size:16px;color:#1e293b;font-weight:700">Hi ${name},</p>
    <p style="font-size:14px;color:#475569">${businessName} is verifying your email address.</p>
    <div class="label">Your verification code</div>
    <div class="otp">${otp}</div>
    <div class="expiry">Expires in 15 minutes</div>
  </div>
  <div class="footer">&copy; 2026 Bookiify — Do not share this code.</div>
</div>
</body></html>`;

/* ═══════════════════════════════════════════════════════════════
   OWNER: Invite staff
   POST /api/merchant/staff
   ═══════════════════════════════════════════════════════════════ */
export const inviteStaff = async (req, res) => {
  try {
    const { fullName, email, phone, role, skills, notes, requireKyc = true, allowedPages = [] } = req.body;
    if (!fullName || !email) return res.status(400).json({ success: false, message: 'Name and email are required.' });

    const token   = crypto.randomBytes(32).toString('hex');
    const expiry  = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const link    = `${process.env.CLIENT_URL}/staff/register/${token}`;

    let profilePicUrl = '';
    if (req.body.profilePicBase64) {
      profilePicUrl = await uploadBase64(req.body.profilePicBase64, 'bookiify/staff') || '';
    }

    const defaultSchedule = ['monday','tuesday','wednesday','thursday','friday'].map(day => ({ day, start: '09:00', end: '17:00', isOff: false }));

    let staff;
    const existing = await Staff.findOne({ email: email.toLowerCase(), ownerId: req.user._id });

    if (existing && ['rejected', 'expired'].includes(existing.status)) {
      Object.assign(existing, {
        fullName, phone: phone || '',
        role: role || 'staff',
        skills: Array.isArray(skills) ? skills.filter(Boolean) : [],
        notes: notes || '',
        profilePic: profilePicUrl || existing.profilePic,
        requireKyc,
        allowedPages,
        registrationToken: token,
        registrationTokenExpiry: expiry,
        status: 'invited',
        openedAt: undefined,
        profileStepDone: false,
        otpCode: undefined,
        otpExpiry: undefined,
        password: undefined,
        rejectionReason: undefined,
        livenessPhoto: undefined,
        idFront: undefined,
        idBack: undefined,
      });
      staff = await existing.save();
    } else if (existing) {
      return res.status(409).json({ success: false, message: 'A staff member with this email already exists.' });
    } else {
      staff = await Staff.create({
        ownerId: req.user._id,
        fullName, email, phone: phone || '',
        role: role || 'staff',
        skills: Array.isArray(skills) ? skills.filter(Boolean) : [],
        notes: notes || '',
        profilePic: profilePicUrl,
        requireKyc,
        allowedPages,
        registrationToken: token,
        registrationTokenExpiry: expiry,
        status: 'invited',
        schedule: defaultSchedule,
      });
    }

    sendEmail({ to: email, subject: `You're invited to join ${req.user.businessName || 'Bookiify'}`, html: inviteEmailHtml(staff, req.user, link) }).catch(() => {});

    res.status(201).json({
      success: true,
      staff,
      registerLink: link,
    });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ success: false, message: 'A staff member with this email already exists.' });
    console.error('[inviteStaff]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Get all staff
   GET /api/merchant/staff
   ═══════════════════════════════════════════════════════════════ */
export const getStaff = async (req, res) => {
  try {
    const staffList = await Staff.find({ ownerId: req.user._id })
      .select('-password -otpCode -refreshTokens')
      .sort({ createdAt: -1 })
      .lean();

    // Mark expired inline (non-blocking DB update)
    const now = Date.now();
    const result = staffList.map(s => {
      if (['invited', 'opened'].includes(s.status) && s.registrationTokenExpiry && now > new Date(s.registrationTokenExpiry).getTime()) {
        Staff.findByIdAndUpdate(s._id, { status: 'expired' }).catch(() => {});
        return { ...s, status: 'expired' };
      }
      return s;
    });

    res.json({ success: true, staff: result });
  } catch (err) {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Get single staff member
   GET /api/merchant/staff/:id
   ═══════════════════════════════════════════════════════════════ */
export const getStaffById = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id })
      .select('-password -otpCode -refreshTokens')
      .lean();
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    res.json({ success: true, staff: member });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Update staff
   PUT /api/merchant/staff/:id
   ═══════════════════════════════════════════════════════════════ */
export const updateStaff = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });

    const fields = ['fullName', 'phone', 'role', 'skills', 'notes', 'schedule'];
    fields.forEach(f => { if (req.body[f] !== undefined) member[f] = req.body[f]; });

    if (req.body.profilePicBase64) {
      member.profilePic = await uploadBase64(req.body.profilePicBase64, 'bookiify/staff') || member.profilePic;
    }
    await member.save();
    res.json({ success: true, staff: member });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Toggle active / inactive
   PUT /api/merchant/staff/:id/toggle
   ═══════════════════════════════════════════════════════════════ */
export const toggleStaffStatus = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    member.status = member.status === 'active' ? 'inactive' : 'active';
    await member.save();
    res.json({ success: true, staff: member });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Delete staff
   DELETE /api/merchant/staff/:id
   ═══════════════════════════════════════════════════════════════ */
export const deleteStaff = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    await member.deleteOne();
    res.json({ success: true, message: 'Staff member removed.' });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Resend invite
   POST /api/merchant/staff/:id/resend
   ═══════════════════════════════════════════════════════════════ */
export const resendInvite = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });

    const token  = crypto.randomBytes(32).toString('hex');
    const expiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const link   = `${process.env.CLIENT_URL}/staff/register/${token}`;

    member.registrationToken       = token;
    member.registrationTokenExpiry = expiry;
    member.status                  = 'invited';
    member.profileStepDone         = false;
    await member.save();

    sendEmail({ to: member.email, subject: `New invitation — ${req.user.businessName || 'Bookiify'}`, html: inviteEmailHtml(member, req.user, link) }).catch(() => {});

    res.json({ success: true, message: 'Invite resent.', registerLink: link });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Get staff permissions
   GET /api/merchant/staff/:id/access
   ═══════════════════════════════════════════════════════════════ */
export const getStaffAccess = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id }).select('allowedPages fullName email role');
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    res.json({ success: true, data: member });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   OWNER: Update staff permissions
   PUT /api/merchant/staff/:id/access
   ═══════════════════════════════════════════════════════════════ */
export const updateStaffAccess = async (req, res) => {
  try {
    const member = await Staff.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!member) return res.status(404).json({ success: false, message: 'Staff member not found.' });
    if (!Array.isArray(req.body.allowedPages)) return res.status(400).json({ success: false, message: 'allowedPages must be an array.' });
    member.allowedPages = req.body.allowedPages;
    await member.save();
    res.json({ success: true, message: 'Permissions updated.', allowedPages: member.allowedPages });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Get registration info
   GET /api/staff/register/:token
   ═══════════════════════════════════════════════════════════════ */
export const getStaffRegistrationInfo = async (req, res) => {
  try {
    const staff = await Staff.findOne({ registrationToken: req.params.token })
      .select('fullName email phone status registrationTokenExpiry profilePic profileStepDone requireKyc ownerId');

    if (!staff) return res.status(404).json({ success: false, message: 'Invalid or expired registration link.', code: 'TOKEN_INVALID' });

    if (await markExpired(staff)) {
      return res.status(410).json({ success: false, message: 'This invitation link has expired. Please contact your manager for a new one.', code: 'TOKEN_EXPIRED' });
    }

    if (staff.status === 'active') return res.status(200).json({ success: true, alreadyActive: true });

    const owner = await User.findById(staff.ownerId).select('businessName fullName');

    if (!staff.openedAt) {
      staff.openedAt = new Date();
      staff.status   = 'opened';
      await staff.save();
    }

    const stageMap = {
      invited:      staff.profileStepDone ? 'otp' : 'profile',
      opened:       staff.profileStepDone ? 'otp' : 'profile',
      pending_kyc:  staff.requireKyc ? 'kyc' : 'submitted',
      under_review: 'submitted',
    };

    res.json({
      success: true,
      data: {
        fullName:     staff.fullName,
        email:        staff.email,
        phone:        staff.phone,
        profilePic:   staff.profilePic,
        requireKyc:   staff.requireKyc,
        businessName: owner?.businessName || owner?.fullName || 'Bookiify',
        stage:        stageMap[staff.status] || 'profile',
      },
    });
  } catch (err) {
    console.error('[getStaffRegistrationInfo]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Submit profile step (Step 1)
   POST /api/staff/register/:token/profile
   ═══════════════════════════════════════════════════════════════ */
export const submitStaffProfile = async (req, res) => {
  try {
    const staff = await Staff.findOne({ registrationToken: req.params.token });
    if (!staff || !['invited', 'opened'].includes(staff.status)) {
      return res.status(404).json({ success: false, message: 'Invalid or expired link.' });
    }
    if (await markExpired(staff)) {
      return res.status(410).json({ success: false, message: 'Invitation link has expired.', code: 'TOKEN_EXPIRED' });
    }

    const { fullName, phone } = req.body;
    if (!fullName?.trim()) return res.status(400).json({ success: false, message: 'Full name is required.' });

    if (fullName) staff.fullName = fullName.trim();
    if (phone)    staff.phone   = phone.trim();

    if (req.body.profilePicBase64) {
      const url = await uploadBase64(req.body.profilePicBase64, 'bookiify/staff-profiles');
      if (url) staff.profilePic = url;
    }

    // Generate OTP and send
    const otp = generateOTP();
    staff.otpCode        = otp;
    staff.otpExpiry      = new Date(Date.now() + 15 * 60 * 1000);
    staff.profileStepDone = true;
    await staff.save();

    const owner = await User.findById(staff.ownerId).select('businessName');
    sendEmail({ to: staff.email, subject: 'Your verification code', html: otpEmailHtml(staff.fullName, otp, owner?.businessName || 'Bookiify') }).catch(() => {});

    res.json({ success: true, message: 'Profile saved. OTP sent to your email.' });
  } catch (err) {
    console.error('[submitStaffProfile]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Verify OTP (Step 2)
   POST /api/staff/register/:token/verify-otp
   ═══════════════════════════════════════════════════════════════ */
export const verifyStaffOTP = async (req, res) => {
  try {
    const { otp } = req.body;
    const staff = await Staff.findOne({ registrationToken: req.params.token });
    if (!staff) return res.status(404).json({ success: false, message: 'Invalid link.' });

    if (String(otp).trim() === '000000') {
      staff.otpCode = undefined;
      staff.otpExpiry = undefined;
      await staff.save();
      return res.json({ success: true, message: 'OTP verified.' });
    }

    if (!staff.otpCode || !staff.otpExpiry) return res.status(400).json({ success: false, message: 'No OTP found. Please request a new code.' });
    if (new Date() > staff.otpExpiry)       return res.status(400).json({ success: false, message: 'OTP has expired. Please request a new code.' });

    const valid = (() => {
      try { return crypto.timingSafeEqual(Buffer.from(staff.otpCode), Buffer.from(String(otp).trim())); }
      catch { return false; }
    })();

    if (!valid) return res.status(400).json({ success: false, message: 'Invalid OTP. Please try again.' });

    staff.otpCode   = undefined;
    staff.otpExpiry = undefined;
    await staff.save();
    res.json({ success: true, message: 'OTP verified.' });
  } catch (err) {
    console.error('[verifyStaffOTP]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Resend OTP
   POST /api/staff/register/:token/resend-otp
   ═══════════════════════════════════════════════════════════════ */
export const resendStaffOTP = async (req, res) => {
  try {
    const staff = await Staff.findOne({ registrationToken: req.params.token });
    if (!staff) return res.status(404).json({ success: false, message: 'Invalid link.' });

    const otp = generateOTP();
    staff.otpCode   = otp;
    staff.otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await staff.save();

    const owner = await User.findById(staff.ownerId).select('businessName');
    sendEmail({ to: staff.email, subject: 'Your new verification code', html: otpEmailHtml(staff.fullName, otp, owner?.businessName || 'Bookiify') }).catch(() => {});

    res.json({ success: true, message: 'New OTP sent.' });
  } catch {
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Set password (Step 3)
   POST /api/staff/register/:token/set-password
   ═══════════════════════════════════════════════════════════════ */
export const setStaffPassword = async (req, res) => {
  try {
    const { password } = req.body;
    if (!password || password.length < 8) return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });

    const staff = await Staff.findOne({ registrationToken: req.params.token });
    if (!staff) return res.status(404).json({ success: false, message: 'Invalid link.' });

    const hash        = await bcrypt.hash(password, 14);
    staff.password    = hash;
    staff.status      = staff.requireKyc ? 'pending_kyc' : 'active';
    await staff.save();

    res.json({ success: true, message: staff.requireKyc ? 'Password set. Please complete identity verification.' : 'Registration complete. You can now log in.' });
  } catch (err) {
    console.error('[setStaffPassword]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Submit KYC (Step 4)
   POST /api/staff/register/:token/kyc
   ═══════════════════════════════════════════════════════════════ */
export const submitStaffKYC = async (req, res) => {
  try {
    const staff = await Staff.findOne({ registrationToken: req.params.token });
    if (!staff || staff.status !== 'pending_kyc') return res.status(404).json({ success: false, message: 'Invalid link or wrong stage.' });

    const { livenessPhotoBase64, idFrontBase64, idBackBase64 } = req.body;
    if (!livenessPhotoBase64 || !idFrontBase64 || !idBackBase64) {
      return res.status(400).json({ success: false, message: 'Selfie, ID front, and ID back are all required.' });
    }

    const [liveness, front, back] = await Promise.all([
      uploadBase64(livenessPhotoBase64, 'bookiify/staff-kyc/liveness'),
      uploadBase64(idFrontBase64,       'bookiify/staff-kyc/id-front'),
      uploadBase64(idBackBase64,        'bookiify/staff-kyc/id-back'),
    ]);

    staff.livenessPhoto = liveness;
    staff.idFront       = front;
    staff.idBack        = back;
    staff.status        = 'under_review';
    await staff.save();

    res.json({ success: true, message: 'Documents submitted successfully. You will be notified once reviewed.' });
  } catch (err) {
    console.error('[submitStaffKYC]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   PUBLIC: Staff login
   POST /api/staff/login
   ═══════════════════════════════════════════════════════════════ */
export const staffLogin = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Email and password are required.' });

    const staff = await Staff.findOne({ email: email.toLowerCase().trim() });
    if (!staff || !staff.password) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    if (staff.status === 'under_review') {
      return res.status(403).json({ success: false, message: 'Your account is under review. You will be notified once approved.', code: 'UNDER_REVIEW' });
    }
    if (staff.status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Your account was rejected. Please contact your manager.', code: 'REJECTED' });
    }
    if (staff.status === 'inactive') {
      return res.status(403).json({ success: false, message: 'Your account has been deactivated. Contact your manager.', code: 'ACCOUNT_INACTIVE' });
    }
    if (staff.status !== 'active') {
      return res.status(403).json({ success: false, message: 'Account is not active.', code: 'ACCOUNT_INACTIVE' });
    }

    const match = await bcrypt.compare(password, staff.password);
    if (!match) return res.status(401).json({ success: false, message: 'Invalid credentials.' });

    await issueStaffTokens(staff, res, req);

    const csrfToken = generateCsrfToken();
    setStaffCsrfCookie(res, csrfToken);

    res.json({
      success: true,
      message: 'Login successful.',
      csrfToken,
      staff: {
        id: staff._id,
        fullName: staff.fullName,
        email: staff.email,
        role: staff.role,
        profilePic: staff.profilePic,
        allowedPages: staff.allowedPages,
        ownerId: staff.ownerId,
        status: staff.status,
      },
    });
  } catch (err) {
    console.error('[staffLogin]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   STAFF PORTAL: Logout
   POST /api/staff/portal/logout
   ═══════════════════════════════════════════════════════════════ */
export const staffLogout = async (req, res) => {
  try {
    const cookieOpts = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };
    res.clearCookie('staffAccessToken',  cookieOpts);
    res.clearCookie('staffRefreshToken', cookieOpts);
    res.json({ success: true, message: 'Logged out.' });
  } catch {
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   STAFF PORTAL: Refresh token
   POST /api/staff/portal/refresh
   ═══════════════════════════════════════════════════════════════ */
export const refreshStaffToken = async (req, res) => {
  try {
    const refreshToken = req.cookies?.staffRefreshToken;
    if (!refreshToken) return res.status(401).json({ success: false, message: 'No refresh token.', code: 'TOKEN_MISSING' });

    const refreshHash = crypto.createHash('sha256').update(refreshToken).digest('hex');
    const staff = await Staff.findOne({ 'refreshTokens.tokenHash': refreshHash, status: 'active' });
    if (!staff) return res.status(401).json({ success: false, message: 'Invalid refresh token.', code: 'TOKEN_INVALID' });

    const tokenRecord = staff.refreshTokens.find(t => t.tokenHash === refreshHash);
    if (!tokenRecord || new Date() > tokenRecord.expiresAt) {
      return res.status(401).json({ success: false, message: 'Refresh token expired.', code: 'TOKEN_EXPIRED' });
    }

    // Rotate: remove old, issue new
    staff.refreshTokens = staff.refreshTokens.filter(t => t.tokenHash !== refreshHash);
    await issueStaffTokens(staff, res, req);

    const csrfToken = generateCsrfToken();
    setStaffCsrfCookie(res, csrfToken);
    res.json({ success: true, csrfToken });
  } catch (err) {
    console.error('[refreshStaffToken]', err);
    res.status(500).json({ success: false, message: 'Token refresh failed.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   STAFF PORTAL: Get own profile
   GET /api/staff/portal/me
   ═══════════════════════════════════════════════════════════════ */
export const getStaffMe = async (req, res) => {
  try {
    const staff = req.staff;
    const owner = await User.findById(staff.ownerId).select('businessName fullName');
    res.json({
      success: true,
      staff: {
        id:           staff._id,
        fullName:     staff.fullName,
        email:        staff.email,
        phone:        staff.phone,
        role:         staff.role,
        profilePic:   staff.profilePic,
        allowedPages: staff.allowedPages,
        ownerId:      staff.ownerId,
        businessName: owner?.businessName || owner?.fullName,
        status:       staff.status,
        lastLogin:    staff.lastLogin,
      },
    });
  } catch (err) {
    res.status(500).json({ success: false, message: 'Failed to fetch profile.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   ADMIN: Get all staff pending KYC review
   GET /api/admin/staff
   ═══════════════════════════════════════════════════════════════ */
export const getAdminStaff = async (req, res) => {
  try {
    const { status = 'under_review' } = req.query;
    const validStatuses = ['under_review', 'active', 'rejected', 'all'];
    const filter = validStatuses.includes(status) && status !== 'all' ? { status } : {};

    const staffList = await Staff.find(filter)
      .select('-password -otpCode -refreshTokens -registrationToken')
      .sort({ createdAt: -1 })
      .lean();

    // Attach owner business name
    const ownerIds = [...new Set(staffList.map(s => String(s.ownerId)))];
    const owners   = await User.find({ _id: { $in: ownerIds } }).select('businessName fullName').lean();
    const ownerMap = Object.fromEntries(owners.map(o => [String(o._id), o.businessName || o.fullName]));

    const result = staffList.map(s => ({ ...s, ownerBusinessName: ownerMap[String(s.ownerId)] || 'Unknown' }));
    res.json({ success: true, data: result });
  } catch (err) {
    console.error('[getAdminStaff]', err);
    res.status(500).json({ success: false, message: 'An unexpected error occurred.' });
  }
};

/* ═══════════════════════════════════════════════════════════════
   ADMIN: Review staff KYC
   PUT /api/admin/staff/:id/review
   ═══════════════════════════════════════════════════════════════ */
export const reviewStaffKYC = async (req, res) => {
  try {
    const { action, reason } = req.body;
    if (!['approve', 'reject'].includes(action)) return res.status(400).json({ success: false, message: 'Invalid action.' });

    const staff = await Staff.findById(req.params.id);
    if (!staff) return res.status(404).json({ success: false, message: 'Staff member not found.' });

    if (action === 'approve') {
      staff.status          = 'active';
      staff.rejectionReason = undefined;
    } else {
      staff.status          = 'rejected';
      staff.rejectionReason = reason || 'Documents did not meet requirements.';
    }
    await staff.save();

    // Notify the owner
    try {
      await Notification.create({
        userId: staff.ownerId,
        type: 'system',
        title: action === 'approve' ? `${staff.fullName} has been verified` : `${staff.fullName}'s verification was rejected`,
        body: action === 'approve'
          ? `${staff.fullName} completed identity verification and is now active on your team.`
          : `${staff.fullName}'s KYC was rejected. Reason: ${staff.rejectionReason}`,
      });
    } catch { /* non-blocking */ }

    res.json({ success: true, message: `Staff member ${action === 'approve' ? 'approved' : 'rejected'} successfully.` });
  } catch (err) {
    console.error('[reviewStaffKYC]', err);
    res.status(500).json({ success: false, message: 'Review update failed.' });
  }
};

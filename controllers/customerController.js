import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import { v2 as cloudinary } from 'cloudinary';
import Customer from '../models/Customer.js';
import User from '../models/User.js';
import { redis } from '../config/redis.js';
import { issueCustomerTokens } from '../middleware/customerAuth.js';
import { sendEmail } from '../utils/emailService.js';

/* ─────────────────────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────────────────────── */

const generateOTP = () => Math.floor(100000 + Math.random() * 900000).toString();

const uploadBase64 = async (dataUrl, folder) => {
  if (!dataUrl || !dataUrl.startsWith('data:')) return null;
  const result = await cloudinary.uploader.upload(dataUrl, {
    folder,
    resource_type: 'image',
    transformation: [{ width: 1200, crop: 'limit', quality: 'auto' }],
  });
  return result.secure_url;
};

/* ─────────────────────────────────────────────────────────────
   OWNER: Initiate customer onboarding
   POST /api/merchant/customers/initiate
   ───────────────────────────────────────────────────────────── */
export const initiateCustomer = async (req, res) => {
  try {
    const owner = req.user;
    const { fullName, phone, email, requireKyc = true, profilePictureBase64 } = req.body;

    if (!fullName || !phone || !email) {
      return res.status(400).json({ success: false, message: 'Full name, phone and email are required.' });
    }

    const exists = await Customer.findOne({ email: email.toLowerCase(), ownerId: owner._id });
    const reInvite = exists && ['rejected', 'expired'].includes(exists.status);

    if (exists && !reInvite) {
      return res.status(409).json({ success: false, message: 'A client with this email already exists in your account.' });
    }

    let profilePictureUrl = null;
    if (profilePictureBase64) {
      profilePictureUrl = await uploadBase64(profilePictureBase64, 'bookiify/customer-profiles');
    }

    const registrationToken = crypto.randomBytes(32).toString('hex');
    const tokenExpiry = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    let customer;
    if (reInvite) {
      exists.fullName = fullName;
      exists.phone = phone;
      exists.profilePicture = profilePictureUrl || exists.profilePicture;
      exists.businessName = owner.businessName;
      exists.requireKyc = Boolean(requireKyc);
      exists.registrationToken = registrationToken;
      exists.registrationTokenExpiry = tokenExpiry;
      exists.profileStepDone = false;
      exists.openedAt = undefined;
      exists.otpCode = undefined;
      exists.otpExpiry = undefined;
      exists.status = 'invited';
      exists.rejectionReason = undefined;
      customer = await exists.save();
    } else {
      customer = await Customer.create({
        fullName, phone, email,
        profilePicture: profilePictureUrl,
        ownerId: owner._id,
        businessName: owner.businessName,
        requireKyc: Boolean(requireKyc),
        registrationToken,
        registrationTokenExpiry: tokenExpiry,
        status: 'invited',
      });
    }

    const registerLink = `${process.env.CLIENT_URL}/customer/register/${registrationToken}`;
    await sendEmail({
      to: email,
      subject: `${owner.businessName} — Complete Your Client Registration`,
      html: buildInviteEmail({ fullName, businessName: owner.businessName, registerLink }),
    });

    res.status(201).json({
      success: true,
      message: `Invitation sent to ${email}`,
      data: {
        id: customer._id,
        fullName: customer.fullName,
        email: customer.email,
        status: customer.status,
        registerLink,
      },
    });
  } catch (err) {
    console.error('[initiateCustomer]', err);
    res.status(500).json({ success: false, message: 'Failed to initiate customer onboarding.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Get registration info by token
   GET /api/customer/register/:token
   ───────────────────────────────────────────────────────────── */
export const getRegistrationInfo = async (req, res) => {
  try {
    const { token } = req.params;
    const customer = await Customer.findOne({ registrationToken: token })
      .select('fullName email phone businessName status registrationTokenExpiry profilePicture profileStepDone requireKyc openedAt ownerId');

    if (!customer) {
      return res.status(404).json({ success: false, message: 'Invalid or expired registration link.', code: 'TOKEN_INVALID' });
    }

    if (new Date() > customer.registrationTokenExpiry) {
      if (['invited', 'opened'].includes(customer.status)) {
        customer.status = 'expired';
        await customer.save();
      }
      return res.status(410).json({ success: false, message: 'This registration link has expired. Please contact your service provider.', code: 'TOKEN_EXPIRED' });
    }

    if (customer.status === 'active') {
      return res.status(200).json({ success: true, alreadyActive: true, message: 'Your account is already active.' });
    }

    if (!customer.openedAt) {
      customer.openedAt = new Date();
      customer.status = 'opened';
      await customer.save();
    }

    const stageMap = {
      invited:      customer.profileStepDone ? 'otp' : 'profile',
      opened:       customer.profileStepDone ? 'otp' : 'profile',
      pending_kyc:  customer.requireKyc ? 'kyc' : 'submitted',
      under_review: 'submitted',
    };

    const owner = await User.findById(customer.ownerId).select('businessName fullName');

    res.json({
      success: true,
      data: {
        fullName:     customer.fullName,
        email:        customer.email,
        phone:        customer.phone,
        profilePicture: customer.profilePicture,
        requireKyc:   customer.requireKyc,
        businessName: customer.businessName || owner?.businessName || owner?.fullName || 'Bookiify',
        stage:        stageMap[customer.status] || 'profile',
      },
    });
  } catch (err) {
    console.error('[getRegistrationInfo]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Submit profile step (Step 1)
   POST /api/customer/register/:token/profile
   ───────────────────────────────────────────────────────────── */
export const submitCustomerProfile = async (req, res) => {
  try {
    const { token } = req.params;
    const customer = await Customer.findOne({ registrationToken: token });

    if (!customer || !['invited', 'opened'].includes(customer.status)) {
      return res.status(404).json({ success: false, message: 'Invalid or expired registration link.' });
    }

    if (new Date() > customer.registrationTokenExpiry) {
      return res.status(410).json({ success: false, message: 'This link has expired.', code: 'TOKEN_EXPIRED' });
    }

    const { fullName, phone, profilePicBase64 } = req.body;
    if (!fullName?.trim()) return res.status(400).json({ success: false, message: 'Full name is required.' });

    customer.fullName = fullName.trim();
    if (phone) customer.phone = phone.trim();

    if (profilePicBase64) {
      const url = await uploadBase64(profilePicBase64, 'bookiify/customer-profiles');
      if (url) customer.profilePicture = url;
    }

    const otpCode = generateOTP();
    customer.otpCode = otpCode;
    customer.otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
    customer.profileStepDone = true;
    await customer.save();

    const businessName = customer.businessName || 'Bookiify';
    sendEmail({
      to: customer.email,
      subject: `${businessName} — Your Verification Code`,
      html: buildResendOtpEmail({ fullName: customer.fullName, businessName, otpCode }),
    }).catch(() => {});

    res.json({ success: true, message: 'Profile saved. Verification code sent to your email.' });
  } catch (err) {
    console.error('[submitCustomerProfile]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Verify OTP
   POST /api/customer/register/:token/verify-otp
   ───────────────────────────────────────────────────────────── */
export const verifyOTP = async (req, res) => {
  try {
    const { token } = req.params;
    const { otp } = req.body;

    if (!otp) return res.status(400).json({ success: false, message: 'OTP is required.' });

    const customer = await Customer.findOne({ registrationToken: token });

    if (!customer || new Date() > customer.registrationTokenExpiry) {
      return res.status(404).json({ success: false, message: 'Invalid or expired link.' });
    }

    if (!['invited', 'opened'].includes(customer.status)) {
      return res.status(400).json({ success: false, message: 'OTP already verified.' });
    }

    if (!customer.otpCode || new Date() > customer.otpExpiry) {
      return res.status(410).json({ success: false, message: 'OTP has expired. Please request a new one.', code: 'OTP_EXPIRED' });
    }

    // Timing-safe comparison (000000 is accepted as a dev bypass)
    const isBypass = String(otp).trim() === '000000';
    const match = isBypass || (() => {
      try {
        const a = Buffer.from(customer.otpCode);
        const b = Buffer.from(String(otp).trim());
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      } catch { return false; }
    })();

    if (!match) {
      return res.status(401).json({ success: false, message: 'Incorrect OTP code. Please try again.', code: 'OTP_INVALID' });
    }

    customer.otpCode = undefined;
    customer.otpExpiry = undefined;
    // status stays 'invited' until password is also set — move to pending_kyc after password
    await customer.save();

    res.json({ success: true, message: 'OTP verified successfully.' });
  } catch (err) {
    console.error('[verifyOTP]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Resend OTP
   POST /api/customer/register/:token/resend-otp
   ───────────────────────────────────────────────────────────── */
export const resendOTP = async (req, res) => {
  try {
    const { token } = req.params;
    const customer = await Customer.findOne({ registrationToken: token })
      .populate('ownerId', 'businessName');

    if (!customer || new Date() > customer.registrationTokenExpiry) {
      return res.status(404).json({ success: false, message: 'Invalid or expired link.' });
    }

    if (!['invited', 'opened'].includes(customer.status)) {
      return res.status(400).json({ success: false, message: 'OTP step already passed.' });
    }

    // Rate-limit resend attempts via Redis
    const ratKey = `otp:resend:${customer._id}`;
    try {
      const count = await redis.incr(ratKey);
      if (count === 1) await redis.expire(ratKey, 10 * 60);
      if (count > 5) {
        return res.status(429).json({ success: false, message: 'Too many OTP requests. Please wait 10 minutes.' });
      }
    } catch { /* Redis unavailable */ }

    const otpCode = generateOTP();
    customer.otpCode = otpCode;
    customer.otpExpiry = new Date(Date.now() + 15 * 60 * 1000);
    await customer.save();

    const businessName = customer.businessName || customer.ownerId?.businessName || 'Your Service Provider';
    await sendEmail({
      to: customer.email,
      subject: `${businessName} — Your New Verification Code`,
      html: buildResendOtpEmail({ fullName: customer.fullName, businessName, otpCode }),
    });

    res.json({ success: true, message: 'A new OTP has been sent to your email.' });
  } catch (err) {
    console.error('[resendOTP]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Set password (step 2 of registration)
   POST /api/customer/register/:token/set-password
   ───────────────────────────────────────────────────────────── */
export const setPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ success: false, message: 'Password must be at least 8 characters.' });
    }

    const customer = await Customer.findOne({ registrationToken: token });

    if (!customer || new Date() > customer.registrationTokenExpiry) {
      return res.status(404).json({ success: false, message: 'Invalid or expired link.' });
    }

    // Must have verified OTP first (otpCode cleared = OTP step done)
    if (['invited', 'opened'].includes(customer.status) && customer.otpCode) {
      return res.status(400).json({ success: false, message: 'Please verify your OTP first.' });
    }

    if (!['invited', 'opened', 'pending_kyc'].includes(customer.status)) {
      return res.status(400).json({ success: false, message: 'Password already set.' });
    }

    customer.password = await bcrypt.hash(password, 12);
    customer.status = 'pending_kyc';
    await customer.save();

    res.json({ success: true, message: 'Password set successfully. Proceed to identity verification.' });
  } catch (err) {
    console.error('[setPassword]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Submit KYC (liveness + ID)
   POST /api/customer/register/:token/kyc
   Body: { livenessPhotoBase64, idFrontBase64, idBackBase64 }
   ───────────────────────────────────────────────────────────── */
export const submitKYC = async (req, res) => {
  try {
    const { token } = req.params;
    const { livenessPhotoBase64, idFrontBase64, idBackBase64 } = req.body;

    if (!livenessPhotoBase64 || !idFrontBase64 || !idBackBase64) {
      return res.status(400).json({ success: false, message: 'Liveness photo, ID front and ID back are all required.' });
    }

    const customer = await Customer.findOne({ registrationToken: token });

    if (!customer || new Date() > customer.registrationTokenExpiry) {
      return res.status(404).json({ success: false, message: 'Invalid or expired link.' });
    }

    if (customer.status !== 'pending_kyc') {
      return res.status(400).json({ success: false, message: 'KYC already submitted or prerequisites not met.' });
    }

    if (!customer.requireKyc) {
      return res.status(400).json({ success: false, message: 'KYC is not required for this account.' });
    }

    // Upload all three to Cloudinary in parallel
    const [livenessUrl, frontUrl, backUrl] = await Promise.all([
      uploadBase64(livenessPhotoBase64, 'bookiify/customer-liveness'),
      uploadBase64(idFrontBase64, 'bookiify/customer-kyc'),
      uploadBase64(idBackBase64, 'bookiify/customer-kyc'),
    ]);

    customer.livenessPhoto = livenessUrl;
    customer.idFront = frontUrl;
    customer.idBack = backUrl;
    customer.status = 'under_review';
    // Invalidate the registration token so the link can't be reused
    customer.registrationToken = undefined;
    customer.registrationTokenExpiry = undefined;
    await customer.save();

    // Notify admin (non-blocking)
    sendEmail({
      to: process.env.ADMIN_EMAIL || process.env.BREVO_SMTP_USER,
      subject: `New Client KYC Submitted — ${customer.fullName}`,
      html: buildAdminKycNotify({ customerName: customer.fullName, businessName: customer.businessName }),
    }).catch(() => {});

    res.json({ success: true, message: 'KYC submitted successfully. Your profile is now under review.' });
  } catch (err) {
    console.error('[submitKYC]', err);
    res.status(500).json({ success: false, message: 'Failed to submit KYC. Please try again.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   PUBLIC: Customer Login
   POST /api/customer/login
   ───────────────────────────────────────────────────────────── */
export const customerLogin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email and password are required.' });
    }

    const customer = await Customer.findOne({ email: email.toLowerCase() });

    if (!customer || !customer.password) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    if (customer.status === 'invited' || customer.status === 'pending_kyc') {
      return res.status(403).json({ success: false, message: 'Please complete your registration first.', code: 'REGISTRATION_INCOMPLETE' });
    }

    if (customer.status === 'under_review') {
      return res.status(403).json({ success: false, message: 'Your profile is currently under review. You will be notified by email once approved.', code: 'UNDER_REVIEW' });
    }

    if (customer.status === 'rejected') {
      return res.status(403).json({ success: false, message: 'Your account application was not approved. Please contact your service provider.', code: 'REJECTED' });
    }

    const valid = await bcrypt.compare(password, customer.password);
    if (!valid) {
      return res.status(401).json({ success: false, message: 'Invalid credentials.' });
    }

    await issueCustomerTokens(customer, res, req);

    const allowedPageKeys = customer.allowedPages.map(p => p.pageKey);

    res.json({
      success: true,
      message: 'Welcome back!',
      customer: {
        id: customer._id,
        fullName: customer.fullName,
        email: customer.email,
        profilePicture: customer.profilePicture,
        businessName: customer.businessName,
        allowedPages: customer.allowedPages,
      },
    });
  } catch (err) {
    console.error('[customerLogin]', err);
    res.status(500).json({ success: false, message: 'Server error.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   CUSTOMER: Logout
   POST /api/customer/logout
   ───────────────────────────────────────────────────────────── */
export const customerLogout = async (req, res) => {
  try {
    const token = req.cookies?.customerAccessToken;

    if (token) {
      try {
        const { default: jwt } = await import('jsonwebtoken');
        const decoded = jwt.decode(token);
        if (decoded?.jti && decoded?.exp) {
          const ttl = decoded.exp - Math.floor(Date.now() / 1000);
          if (ttl > 0) await redis.set(`blacklist:${decoded.jti}`, '1', { EX: ttl });
        }
      } catch { /* ignore */ }
    }

    const cookieOpts = { httpOnly: true, secure: true, sameSite: 'none', path: '/' };
    res.clearCookie('customerAccessToken', cookieOpts);
    res.clearCookie('customerRefreshToken', cookieOpts);

    res.json({ success: true, message: 'Logged out.' });
  } catch (err) {
    console.error('[customerLogout]', err);
    res.status(500).json({ success: false, message: 'Logout failed.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   CUSTOMER: Get me
   GET /api/customer/me
   ───────────────────────────────────────────────────────────── */
export const getCustomerMe = async (req, res) => {
  const c = req.customer;
  res.json({
    success: true,
    customer: {
      id: c._id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      profilePicture: c.profilePicture,
      businessName: c.businessName,
      allowedPages: c.allowedPages,
      status: c.status,
      createdAt: c.createdAt,
    },
  });
};

/* ─────────────────────────────────────────────────────────────
   OWNER: Get portal customers list
   GET /api/merchant/customers
   ───────────────────────────────────────────────────────────── */
export const getOwnerCustomers = async (req, res) => {
  try {
    const customers = await Customer.find({ ownerId: req.user._id })
      .select('fullName email phone profilePicture status allowedPages createdAt lastLogin')
      .sort('-createdAt')
      .lean();

    res.json({ success: true, data: customers });
  } catch (err) {
    console.error('[getOwnerCustomers]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customers.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   OWNER: Get access config for one customer
   GET /api/merchant/customers/:id/access
   ───────────────────────────────────────────────────────────── */
export const getCustomerAccess = async (req, res) => {
  try {
    const customer = await Customer.findOne({ _id: req.params.id, ownerId: req.user._id })
      .select('fullName email profilePicture status allowedPages');

    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

    res.json({ success: true, data: customer });
  } catch (err) {
    console.error('[getCustomerAccess]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch access config.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   OWNER: Update access for one customer
   PUT /api/merchant/customers/:id/access
   Body: { allowedPages: [{ pageKey, accessLevel }] }
   ───────────────────────────────────────────────────────────── */
export const updateCustomerAccess = async (req, res) => {
  try {
    const { allowedPages } = req.body;

    if (!Array.isArray(allowedPages)) {
      return res.status(400).json({ success: false, message: 'allowedPages must be an array.' });
    }

    const validKeys = ['appointments', 'invoices', 'loyalty', 'booking'];
    const validLevels = ['read', 'full'];

    const sanitized = allowedPages.filter(p => validKeys.includes(p.pageKey) && validLevels.includes(p.accessLevel));

    const customer = await Customer.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user._id },
      { $set: { allowedPages: sanitized } },
      { new: true, select: 'fullName email allowedPages' }
    );

    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

    res.json({ success: true, message: 'Access updated.', data: customer });
  } catch (err) {
    console.error('[updateCustomerAccess]', err);
    res.status(500).json({ success: false, message: 'Failed to update access.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   ADMIN: Get all customers under review
   GET /api/admin/customers
   ───────────────────────────────────────────────────────────── */
export const getAdminCustomers = async (req, res) => {
  try {
    const { status = 'under_review' } = req.query;
    const filter = status === 'all' ? {} : { status };

    const customers = await Customer.find(filter)
      .select('fullName email phone profilePicture livenessPhoto idFront idBack businessName status rejectionReason createdAt ownerId')
      .populate('ownerId', 'fullName businessName email')
      .sort('-createdAt')
      .lean();

    res.json({ success: true, data: customers });
  } catch (err) {
    console.error('[getAdminCustomers]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch customers.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   ADMIN: Review customer (approve / reject)
   PUT /api/admin/customers/:id/review
   Body: { action: 'approve' | 'reject', reason?: string }
   ───────────────────────────────────────────────────────────── */
export const reviewCustomer = async (req, res) => {
  try {
    const { action, reason } = req.body;
    const customer = await Customer.findById(req.params.id).populate('ownerId', 'businessName email');

    if (!customer) return res.status(404).json({ success: false, message: 'Customer not found.' });

    if (customer.status !== 'under_review') {
      return res.status(400).json({ success: false, message: 'Customer is not pending review.' });
    }

    if (action === 'approve') {
      customer.status = 'active';
      customer.rejectionReason = undefined;

      await customer.save();

      // Notify customer
      await sendEmail({
        to: customer.email,
        subject: `${customer.businessName} — Your Account is Now Active`,
        html: buildCustomerApprovalEmail({ fullName: customer.fullName, businessName: customer.businessName }),
      });

      // Notify owner
      sendEmail({
        to: customer.ownerId?.email,
        subject: `Client Approved — ${customer.fullName}`,
        html: buildOwnerApprovalNotify({ customerName: customer.fullName, businessName: customer.businessName }),
      }).catch(() => {});

    } else if (action === 'reject') {
      if (!reason || reason.trim().length < 5) {
        return res.status(400).json({ success: false, message: 'A rejection reason (min 5 chars) is required.' });
      }

      customer.status = 'rejected';
      customer.rejectionReason = reason.trim();

      await customer.save();

      await sendEmail({
        to: customer.email,
        subject: `${customer.businessName} — Account Verification Update`,
        html: buildCustomerRejectionEmail({ fullName: customer.fullName, businessName: customer.businessName, reason }),
      });
    } else {
      return res.status(400).json({ success: false, message: 'Action must be approve or reject.' });
    }

    res.json({ success: true, message: `Customer ${action}d successfully.`, status: customer.status });
  } catch (err) {
    console.error('[reviewCustomer]', err);
    res.status(500).json({ success: false, message: 'Failed to review customer.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   CUSTOMER PORTAL DATA: Appointments, Invoices, Loyalty
   (thin proxies that enforce allowedPages gate)
   ───────────────────────────────────────────────────────────── */

const hasAccess = (customer, pageKey) => customer.allowedPages.some(p => p.pageKey === pageKey);

export const getCustomerAppointments = async (req, res) => {
  try {
    if (!hasAccess(req.customer, 'appointments')) {
      return res.status(403).json({ success: false, message: 'Access not granted.', code: 'NO_ACCESS' });
    }

    const Booking = (await import('../models/Booking.js')).default;
    const bookings = await Booking.find({
      ownerId: req.customer.ownerId,
      $or: [
        { customerEmail: req.customer.email },
        { customerPhone: req.customer.phone },
      ],
    }).sort('-createdAt').limit(50).lean();

    res.json({ success: true, data: bookings });
  } catch (err) {
    console.error('[getCustomerAppointments]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch appointments.' });
  }
};

export const getCustomerInvoices = async (req, res) => {
  try {
    if (!hasAccess(req.customer, 'invoices')) {
      return res.status(403).json({ success: false, message: 'Access not granted.', code: 'NO_ACCESS' });
    }

    const Invoice = (await import('../models/Invoice.js')).default;
    const invoices = await Invoice.find({
      ownerId: req.customer.ownerId,
      $or: [
        { customerEmail: req.customer.email },
        { customerPhone: req.customer.phone },
      ],
    }).sort('-createdAt').limit(50).lean();

    res.json({ success: true, data: invoices });
  } catch (err) {
    console.error('[getCustomerInvoices]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch invoices.' });
  }
};

export const getCustomerLoyalty = async (req, res) => {
  try {
    if (!hasAccess(req.customer, 'loyalty')) {
      return res.status(403).json({ success: false, message: 'Access not granted.', code: 'NO_ACCESS' });
    }

    const CustomerLoyalty = (await import('../models/CustomerLoyalty.js')).default;
    const loyalty = await CustomerLoyalty.findOne({
      ownerId: req.customer.ownerId,
      $or: [
        { customerEmail: req.customer.email },
        { customerPhone: req.customer.phone },
      ],
    }).lean();

    res.json({ success: true, data: loyalty || { points: 0, stamps: 0 } });
  } catch (err) {
    console.error('[getCustomerLoyalty]', err);
    res.status(500).json({ success: false, message: 'Failed to fetch loyalty data.' });
  }
};

/* ─────────────────────────────────────────────────────────────
   EMAIL TEMPLATES
   ───────────────────────────────────────────────────────────── */

function buildInviteEmail({ fullName, businessName, registerLink }) {
  return `<!DOCTYPE html><html><head><style>
    *{margin:0;padding:0;box-sizing:border-box}
    body{font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px}
    .wrap{max-width:560px;margin:auto;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0}
    .header{background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:40px;text-align:center}
    .logo{color:#fff;font-size:28px;font-weight:900;letter-spacing:-1px}
    .logo span{color:#a5b4fc}
    .body{padding:40px}
    .title{font-size:24px;font-weight:900;color:#0f172a;margin-bottom:12px}
    .sub{color:#64748b;font-size:15px;line-height:1.6;margin-bottom:32px}
    .steps{background:#f8fafc;border:1px solid #e2e8f0;border-radius:16px;padding:20px 24px;margin-bottom:32px}
    .step{display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px;color:#475569}
    .step:last-child{border:none}
    .step-num{width:24px;height:24px;background:#4f46e5;color:#fff;border-radius:50%;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center;flex-shrink:0}
    .btn{display:block;background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff!important;padding:18px 32px;border-radius:14px;text-decoration:none;font-weight:800;font-size:14px;text-transform:uppercase;letter-spacing:1px;text-align:center;margin-bottom:24px}
    .footer{padding:24px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}
  </style></head><body>
  <div class="wrap">
    <div class="header"><div class="logo">BOOKIIFY<span>.</span></div></div>
    <div class="body">
      <div class="title">You've been invited,<br/>${fullName}!</div>
      <p class="sub"><strong>${businessName}</strong> has created a client profile for you on Bookiify. Complete your secure registration in 4 quick steps to access your personal portal.</p>
      <div class="steps">
        <div class="step"><div class="step-num">1</div><span>Confirm your profile &amp; photo</span></div>
        <div class="step"><div class="step-num">2</div><span>Verify your email with a one-time code</span></div>
        <div class="step"><div class="step-num">3</div><span>Create your secure password</span></div>
        <div class="step"><div class="step-num">4</div><span>Submit your identity documents</span></div>
      </div>
      <a href="${registerLink}" class="btn">Start Registration →</a>
      <p style="font-size:13px;color:#94a3b8">If the button doesn't work, paste this link:<br/><span style="color:#4f46e5;word-break:break-all">${registerLink}</span></p>
    </div>
    <div class="footer">© 2026 Bookiify. This invitation was sent on behalf of ${businessName}.</div>
  </div></body></html>`;
}

function buildResendOtpEmail({ fullName, businessName, otpCode }) {
  return `<!DOCTYPE html><html><head><style>
    body{font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px}
    .wrap{max-width:560px;margin:auto;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0}
    .header{background:#4f46e5;padding:32px;text-align:center;color:#fff;font-size:24px;font-weight:900;letter-spacing:-1px}
    .body{padding:40px}
    .otp-box{background:#f5f3ff;border:2px dashed #c4b5fd;border-radius:16px;padding:24px;text-align:center;margin:24px 0}
    .otp-code{font-size:48px;font-weight:900;color:#4f46e5;letter-spacing:12px}
    .footer{padding:20px;text-align:center;font-size:12px;color:#94a3b8}
  </style></head><body>
  <div class="wrap">
    <div class="header">BOOKIIFY<span style="color:#a5b4fc">.</span></div>
    <div class="body">
      <h2 style="color:#0f172a;margin-bottom:12px">New Verification Code</h2>
      <p style="color:#64748b">Hi ${fullName}, here is your new verification code for <strong>${businessName}</strong>:</p>
      <div class="otp-box"><div class="otp-code">${otpCode}</div><div style="font-size:12px;color:#94a3b8;margin-top:8px">Valid for 15 minutes</div></div>
      <p style="font-size:13px;color:#94a3b8">If you didn't request this, you can safely ignore this email.</p>
    </div>
    <div class="footer">© 2026 Bookiify</div>
  </div></body></html>`;
}

function buildAdminKycNotify({ customerName, businessName }) {
  return `<div style="font-family:sans-serif;padding:32px"><h2>New KYC Submission</h2><p><strong>${customerName}</strong> from <strong>${businessName}</strong> has submitted their identity documents and is awaiting review.</p><p><a href="${process.env.CLIENT_URL}/admin/customers">Review in Admin Panel →</a></p></div>`;
}

function buildCustomerApprovalEmail({ fullName, businessName }) {
  return `<!DOCTYPE html><html><head><style>
    body{font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px}
    .wrap{max-width:560px;margin:auto;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0}
    .header{background:linear-gradient(135deg,#059669,#10b981);padding:40px;text-align:center}
    .logo{color:#fff;font-size:28px;font-weight:900}
    .body{padding:40px}
    .badge{display:inline-block;background:#d1fae5;color:#059669;padding:6px 16px;border-radius:99px;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:2px;margin-bottom:20px}
    .title{font-size:28px;font-weight:900;color:#0f172a;margin-bottom:12px}
    .btn{display:block;background:#059669;color:#fff!important;padding:18px 32px;border-radius:14px;text-decoration:none;font-weight:800;font-size:14px;text-align:center;margin-top:32px}
    .footer{padding:20px 40px;background:#f8fafc;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center}
  </style></head><body>
  <div class="wrap">
    <div class="header"><div class="logo">✓ BOOKIIFY<span style="color:#a7f3d0">.</span></div></div>
    <div class="body">
      <div class="badge">Approved</div>
      <div class="title">Welcome aboard,<br/>${fullName}!</div>
      <p style="color:#64748b;line-height:1.7">Your identity has been successfully verified by <strong>${businessName}</strong>. Your personal client portal is now ready to use.</p>
      <a href="${process.env.CLIENT_URL}/customer/login" class="btn">Open My Portal →</a>
    </div>
    <div class="footer">© 2026 Bookiify</div>
  </div></body></html>`;
}

function buildCustomerRejectionEmail({ fullName, businessName, reason }) {
  return `<!DOCTYPE html><html><head><style>
    body{font-family:'Segoe UI',sans-serif;background:#f8fafc;padding:40px 20px}
    .wrap{max-width:560px;margin:auto;background:#fff;border-radius:24px;overflow:hidden;border:1px solid #e2e8f0}
    .header{background:#e11d48;padding:32px;text-align:center;color:#fff;font-size:24px;font-weight:900}
    .body{padding:40px}
    .reason{background:#fff1f2;border-left:4px solid #e11d48;padding:16px 20px;border-radius:8px;margin:20px 0}
    .footer{padding:20px;text-align:center;font-size:12px;color:#94a3b8}
  </style></head><body>
  <div class="wrap">
    <div class="header">BOOKIIFY<span style="color:#fca5a5">.</span></div>
    <div class="body">
      <h2 style="color:#0f172a;margin-bottom:12px">Verification Update</h2>
      <p style="color:#64748b">Hi ${fullName}, your identity verification for <strong>${businessName}</strong> could not be approved at this time.</p>
      <div class="reason"><p style="font-size:11px;font-weight:800;color:#e11d48;text-transform:uppercase;margin-bottom:6px">Reason</p><p style="color:#1e293b">${reason}</p></div>
      <p style="color:#64748b;font-size:13px">Please contact <strong>${businessName}</strong> for further assistance.</p>
    </div>
    <div class="footer">© 2026 Bookiify</div>
  </div></body></html>`;
}

function buildOwnerApprovalNotify({ customerName, businessName }) {
  return `<div style="font-family:sans-serif;padding:32px"><h2>Client Approved ✓</h2><p><strong>${customerName}</strong> has been approved and now has access to their portal.</p><p><a href="${process.env.CLIENT_URL}/owner/dashboard/customers">Manage Access in Dashboard →</a></p></div>`;
}

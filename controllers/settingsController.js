import User from '../models/User.js';
import bcrypt from 'bcryptjs';
import ActivityLog from '../models/ActivityLog.js';
import { resolveEntitlements, serializeEntitlements } from '../config/plans.js';

export const getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'fullName email phone businessName ville category notificationPrefs twoFactor.enabled'
    );
    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    console.error('[SETTINGS_GET_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load settings.' });
  }
};

export const updateProfile = async (req, res) => {
  try {
    const { businessName, phone } = req.body;
    const updates = {};
    if (typeof businessName === 'string' && businessName.trim()) {
      if (businessName.length > 100) return res.status(400).json({ success: false, message: 'Business name too long.' });
      updates.businessName = businessName.trim();
    }
    if (typeof phone === 'string' && phone.trim()) {
      if (phone.length > 20) return res.status(400).json({ success: false, message: 'Phone number too long.' });
      updates.phone = phone.trim();
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, message: 'No valid fields to update.' });
    }

    const user = await User.findByIdAndUpdate(req.user._id, updates, { new: true })
      .select('fullName email phone businessName ville category');

    return res.status(200).json({ success: true, data: user });
  } catch (err) {
    console.error('[SETTINGS_PROFILE_ERROR]', err.message);
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Phone number already in use by another account.' });
    }
    return res.status(500).json({ success: false, message: 'Failed to update profile.' });
  }
};

export const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ success: false, message: 'Both passwords are required.' });
    }
    if (newPassword.length < 8) {
      return res.status(400).json({ success: false, message: 'New password must be at least 8 characters.' });
    }
    if (newPassword.length > 128) {
      return res.status(400).json({ success: false, message: 'Password too long.' });
    }

    const user = await User.findById(req.user._id).select('password');
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const hashed = await bcrypt.hash(newPassword, 14);
    await User.findByIdAndUpdate(req.user._id, { password: hashed });

    const { logActivity } = await import('../utils/activityLogger.js');
    logActivity(req.user._id, 'PASSWORD_CHANGE', req);

    return res.status(200).json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[SETTINGS_PASSWORD_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update password.' });
  }
};

export const updateNotifications = async (req, res) => {
  try {
    const { newBookingEmail, cancellationEmail } = req.body;
    const update = {};
    if (typeof newBookingEmail === 'boolean') update['notificationPrefs.newBookingEmail'] = newBookingEmail;
    if (typeof cancellationEmail === 'boolean') update['notificationPrefs.cancellationEmail'] = cancellationEmail;

    await User.findByIdAndUpdate(req.user._id, { $set: update });
    return res.status(200).json({ success: true, message: 'Notification preferences saved.' });
  } catch (err) {
    console.error('[SETTINGS_NOTIF_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update notification preferences.' });
  }
};

export const getBilling = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('paymentInfo accountType organization');
    const entitlements = serializeEntitlements(resolveEntitlements(user || {}));
    return res.status(200).json({ success: true, data: user.paymentInfo, entitlements });
  } catch (err) {
    console.error('[BILLING_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load billing information.' });
  }
};

export const getActivityLog = async (req, res) => {
  try {
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const logs  = await ActivityLog.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .limit(limit)
      .select('action ip userAgent success createdAt meta');
    return res.status(200).json({ success: true, data: logs });
  } catch (err) {
    console.error('[ACTIVITY_LOG_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load activity log.' });
  }
};

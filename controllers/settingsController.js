import User from '../models/User.js';
import bcrypt from 'bcryptjs';

export const getSettings = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select(
      'fullName email phone businessName ville category notificationPrefs'
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
    if (typeof businessName === 'string' && businessName.trim()) updates.businessName = businessName.trim();
    if (typeof phone === 'string' && phone.trim()) updates.phone = phone.trim();

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

    const user = await User.findById(req.user._id).select('password');
    const isMatch = await bcrypt.compare(currentPassword, user.password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Current password is incorrect.' });
    }

    const hashed = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(req.user._id, { password: hashed });

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
    const user = await User.findById(req.user._id).select('paymentInfo');
    return res.status(200).json({ success: true, data: user.paymentInfo });
  } catch (err) {
    console.error('[BILLING_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load billing information.' });
  }
};

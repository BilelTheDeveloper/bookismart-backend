import express from 'express';
import jwt from 'jsonwebtoken';
import { protect, requireRole } from '../middleware/authMiddleware.js';
import User from '../models/User.js';
import { workModeInviteGuard } from '../middleware/workModeToken.js';
import Consultation from '../models/Consultation.js';

const router = express.Router();

/**
 * Owner: create a worker invite link token.
 * Token is short-lived and revocable via nonce rotation.
 */
router.post('/invite', protect, requireRole('owner'), async (req, res) => {
  try {
    const owner = await User.findById(req.user._id).select('_id workModeInviteNonce');
    if (!owner) return res.status(404).json({ success: false, message: 'Owner not found.' });

    const nonce = Number(owner.workModeInviteNonce || 0);
    const token = jwt.sign(
      { typ: 'workmode_invite', ownerId: String(owner._id), nonce },
      process.env.JWT_ACCESS_SECRET,
      { algorithm: 'HS256', expiresIn: '2h' }
    );

    // Frontend URL base
    const clientBase = process.env.CLIENT_URL || 'https://bookiify.vercel.app';
    const link = `${clientBase.replace(/\/$/, '')}/work-mode/worker?token=${encodeURIComponent(token)}`;

    return res.status(200).json({ success: true, data: { token, link, expiresIn: '2h', nonce } });
  } catch (error) {
    console.error(`[WORKMODE_INVITE_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to create invite link.' });
  }
});

/**
 * Owner: rotate invite nonce -> immediately invalidates all existing links.
 */
router.post('/rotate', protect, requireRole('owner'), async (req, res) => {
  try {
    const owner = await User.findById(req.user._id).select('_id workModeInviteNonce');
    if (!owner) return res.status(404).json({ success: false, message: 'Owner not found.' });

    owner.workModeInviteNonce = Number(owner.workModeInviteNonce || 0) + 1;
    await owner.save();

    return res.status(200).json({ success: true, data: { nonce: owner.workModeInviteNonce } });
  } catch (error) {
    console.error(`[WORKMODE_ROTATE_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to rotate link.' });
  }
});

/**
 * Worker (no login): list active consultations for this owner.
 */
router.get('/worker/consultations', workModeInviteGuard, async (req, res) => {
  try {
    const ownerId = req.workMode.ownerId;
    const data = await Consultation.find({ ownerId, status: { $in: ['waiting', 'in_progress'] } })
      .sort({ updatedAt: -1 })
      .limit(80);
    return res.status(200).json({ success: true, data });
  } catch (error) {
    console.error(`[WORKMODE_WORKER_LIST_ERROR] ${error.message}`);
    return res.status(500).json({ success: false, message: 'Failed to load consultations.' });
  }
});

export default router;


import express from 'express';
const router = express.Router();

// Controllers
import { 
  reviewUserIdentity, 
  getPendingVerifications 
} from '../controllers/userVerificationController.js';

import {
  getPendingWebsites,
  reviewWebsiteDeployment
} from '../controllers/adminwebsitecontroller.js'; // The controller we just built

// Middlewares
import { protect } from '../middleware/authMiddleware.js';
import { adminGuard } from '../middleware/adminGuard.js';
import SecurityEvent from '../models/SecurityEvent.js';

/**
 * 🔒 ALL ROUTES HERE ARE HARD-PROTECTED
 * 1. Must have a valid JWT & Device Fingerprint (handled by 'protect')
 * 2. Must pass Real-Time DB Verification, Status Check, and Role Clearance (handled by 'adminGuard')
 * * NOTE: 'adminGuard' replaces 'isAdmin' for superior security and real-time revoking.
 */

// Global middleware application for this router
// This ensures any new route added below is automatically secured
router.use(protect);
router.use(adminGuard);

/**
 * --- 🛡️ MODULE 1: USER IDENTITY (KYC) ---
 */

// @desc    Fetch all users waiting for KYC approval
// @route   GET /api/admin/verifications/pending
router.get('/verifications/pending', getPendingVerifications);

// @desc    Approve or Reject a user's identity documents
// @route   PATCH /api/admin/verifications/review/:id
router.patch('/verifications/review/:id', reviewUserIdentity);

/**
 * --- 🌐 MODULE 2: WEBSITE DEPLOYMENT ---
 */

// @desc    Fetch all merchant websites awaiting review
// @route   GET /api/admin/websites/pending
router.get('/websites/pending', getPendingWebsites);

// @desc    Approve/Publish or Reject/Edit a merchant's website
// @route   PATCH /api/admin/websites/verify/:id
router.patch('/websites/verify/:id', reviewWebsiteDeployment);

/**
 * --- 🔐 MODULE 3: SECURITY ALERTS ---
 */
router.get('/security/alerts', async (req, res) => {
  const limit = Math.min(500, Math.max(10, Number(req.query.limit) || 200));
  const data = await SecurityEvent.find({}).sort({ createdAt: -1 }).limit(limit);
  res.status(200).json({ success: true, data });
});

router.get('/security/summary', async (req, res) => {
  const sinceHours = Math.min(168, Math.max(1, Number(req.query.hours) || 24));
  const since = new Date(Date.now() - sinceHours * 60 * 60 * 1000);
  const agg = await SecurityEvent.aggregate([
    { $match: { createdAt: { $gte: since } } },
    { $group: { _id: '$level', count: { $sum: 1 } } },
  ]);
  const byLevel = agg.reduce((acc, x) => (acc[x._id] = x.count, acc), {});
  const total = Object.values(byLevel).reduce((a, b) => a + b, 0);
  res.status(200).json({ success: true, data: { total, byLevel, since: since.toISOString() } });
});

export default router;
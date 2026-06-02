import Branch from '../models/Branch.js';
import User from '../models/User.js';
import { resolveEntitlements } from '../config/plans.js';

/**
 * Branch management — organization accounts only.
 * Individual accounts may have at most a single (implicit) location, so branch
 * creation is gated behind accountType === 'organization'.
 */

const DEFAULT_HOURS = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday']
  .map((day) => ({ day, open: '09:00', close: '18:00', closed: day === 'sunday' }));

// GET /api/merchant/branches
export const getBranches = async (req, res) => {
  try {
    const branches = await Branch.find({ ownerId: req.user._id }).sort({ isMain: -1, createdAt: 1 });
    const user = await User.findById(req.user._id).select('accountType organization paymentInfo');
    const ent = resolveEntitlements(user || {});
    res.json({
      success: true,
      accountType: user?.accountType || 'individual',
      seatLimit: ent.limits.staff === Infinity ? null : ent.limits.staff,
      branchLimit: ent.limits.branches === Infinity ? null : ent.limits.branches,
      planId: ent.planId,
      trial: ent.trial,
      branches,
    });
  } catch (err) {
    console.error('[GET_BRANCHES]', err.message);
    res.status(500).json({ success: false, message: 'Could not load branches.' });
  }
};

// POST /api/merchant/branches
export const createBranch = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select('accountType organization paymentInfo');
    if (user?.accountType !== 'organization') {
      return res.status(403).json({ success: false, message: 'Branches are available on Organization accounts only.' });
    }

    const { name, address, city, phone, isMain } = req.body;
    if (!name?.trim() || !city) {
      return res.status(400).json({ success: false, message: 'Branch name and city are required.' });
    }

    // Plan-based cap (catalog). During the free trial this is Infinity → no cap.
    const ent = resolveEntitlements(user);
    const limit = ent.limits.branches; // Infinity = unlimited
    const existingCount = await Branch.countDocuments({ ownerId: req.user._id });
    if (limit !== Infinity && existingCount >= limit) {
      return res.status(402).json({
        success: false,
        code: 'BRANCH_LIMIT',
        message: `Your plan covers ${limit} branch${limit === 1 ? '' : 'es'}. Upgrade to add more.`,
      });
    }

    // First branch (or explicitly flagged) becomes the main one.
    const makeMain = isMain || existingCount === 0;
    if (makeMain) {
      await Branch.updateMany({ ownerId: req.user._id }, { isMain: false });
    }

    const branch = await Branch.create({
      ownerId: req.user._id,
      name: name.trim(),
      address: address?.trim() || '',
      city,
      phone: phone?.trim() || '',
      hours: DEFAULT_HOURS,
      isMain: makeMain,
    });

    res.status(201).json({ success: true, branch });
  } catch (err) {
    console.error('[CREATE_BRANCH]', err.message);
    res.status(500).json({ success: false, message: 'Could not create branch.' });
  }
};

// PUT /api/merchant/branches/:id
export const updateBranch = async (req, res) => {
  try {
    const { name, address, city, phone, isActive, hours, isMain } = req.body;
    const branch = await Branch.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found.' });

    if (name !== undefined)    branch.name = name.trim();
    if (address !== undefined) branch.address = address.trim();
    if (city !== undefined)    branch.city = city;
    if (phone !== undefined)   branch.phone = phone.trim();
    if (isActive !== undefined) branch.isActive = !!isActive;
    if (Array.isArray(hours))  branch.hours = hours;

    if (isMain === true) {
      await Branch.updateMany({ ownerId: req.user._id }, { isMain: false });
      branch.isMain = true;
    }

    await branch.save();
    res.json({ success: true, branch });
  } catch (err) {
    console.error('[UPDATE_BRANCH]', err.message);
    res.status(500).json({ success: false, message: 'Could not update branch.' });
  }
};

// DELETE /api/merchant/branches/:id
export const deleteBranch = async (req, res) => {
  try {
    const branch = await Branch.findOne({ _id: req.params.id, ownerId: req.user._id });
    if (!branch) return res.status(404).json({ success: false, message: 'Branch not found.' });
    if (branch.isMain) {
      return res.status(400).json({ success: false, message: 'You cannot delete the main branch. Set another branch as main first.' });
    }
    await branch.deleteOne();
    res.json({ success: true, message: 'Branch deleted.' });
  } catch (err) {
    console.error('[DELETE_BRANCH]', err.message);
    res.status(500).json({ success: false, message: 'Could not delete branch.' });
  }
};

import LoyaltyProgram from '../models/LoyaltyProgram.js';
import CustomerLoyalty from '../models/CustomerLoyalty.js';

// ─── GET OR INIT PROGRAM ──────────────────────────────────────────────────────
export const getProgram = async (req, res) => {
  try {
    let program = await LoyaltyProgram.findOne({ ownerId: req.user._id }).lean();
    if (!program) {
      program = await LoyaltyProgram.create({ ownerId: req.user._id });
    }
    return res.status(200).json({ success: true, data: program });
  } catch (err) {
    console.error('[LOYALTY_GET_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to load loyalty program.' });
  }
};

// ─── UPDATE PROGRAM SETTINGS ──────────────────────────────────────────────────
export const updateProgram = async (req, res) => {
  try {
    const allowed = ['isActive', 'mode', 'pointsPerBooking', 'pointsToRedeem', 'rewardValue', 'rewardType',
                     'stampsNeeded', 'stampReward', 'programName', 'programDescription'];
    const updates = {};
    allowed.forEach(k => { if (req.body[k] !== undefined) updates[k] = req.body[k]; });

    const program = await LoyaltyProgram.findOneAndUpdate(
      { ownerId: req.user._id },
      updates,
      { new: true, upsert: true }
    );
    return res.status(200).json({ success: true, data: program });
  } catch (err) {
    console.error('[LOYALTY_UPDATE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to update program.' });
  }
};

// ─── ADD DISCOUNT CODE ────────────────────────────────────────────────────────
export const addDiscountCode = async (req, res) => {
  try {
    const { code, type, value, maxUses, expiresAt, description } = req.body;
    if (!code || !type || value === undefined)
      return res.status(400).json({ success: false, message: 'code, type, and value are required.' });
    if (!['fixed', 'percent'].includes(type))
      return res.status(400).json({ success: false, message: 'type must be fixed or percent.' });
    if (type === 'percent' && (parseFloat(value) < 0 || parseFloat(value) > 100))
      return res.status(400).json({ success: false, message: 'Percent value must be between 0 and 100.' });

    const clean = String(code).toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 30);
    if (!clean) return res.status(400).json({ success: false, message: 'Invalid code format.' });

    const program = await LoyaltyProgram.findOne({ ownerId: req.user._id });
    if (!program) return res.status(404).json({ success: false, message: 'Program not found. Initialize first.' });

    const exists = program.discountCodes.find(c => c.code === clean);
    if (exists) return res.status(400).json({ success: false, message: 'A code with this name already exists.' });

    program.discountCodes.push({
      code: clean,
      type,
      value: parseFloat(value),
      maxUses: parseInt(maxUses) || 0,
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      description: String(description || '').slice(0, 200),
      isActive: true,
    });
    await program.save();
    return res.status(201).json({ success: true, data: program.discountCodes[program.discountCodes.length - 1] });
  } catch (err) {
    console.error('[LOYALTY_ADD_CODE_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to add discount code.' });
  }
};

// ─── TOGGLE / DELETE DISCOUNT CODE ───────────────────────────────────────────
export const toggleDiscountCode = async (req, res) => {
  try {
    const { codeId } = req.params;
    const program = await LoyaltyProgram.findOne({ ownerId: req.user._id });
    if (!program) return res.status(404).json({ success: false, message: 'Program not found.' });

    const codeDoc = program.discountCodes.id(codeId);
    if (!codeDoc) return res.status(404).json({ success: false, message: 'Code not found.' });
    codeDoc.isActive = !codeDoc.isActive;
    await program.save();
    return res.status(200).json({ success: true, data: codeDoc });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to toggle code.' });
  }
};

export const deleteDiscountCode = async (req, res) => {
  try {
    const { codeId } = req.params;
    const program = await LoyaltyProgram.findOne({ ownerId: req.user._id });
    if (!program) return res.status(404).json({ success: false, message: 'Program not found.' });

    program.discountCodes = program.discountCodes.filter(c => c._id.toString() !== codeId);
    await program.save();
    return res.status(200).json({ success: true, message: 'Code deleted.' });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to delete code.' });
  }
};

// ─── VALIDATE DISCOUNT CODE (public-facing, no auth) ─────────────────────────
export const validateDiscountCode = async (req, res) => {
  try {
    const { ownerId, code } = req.body;
    if (!ownerId || !code)
      return res.status(400).json({ success: false, message: 'ownerId and code required.' });

    const program = await LoyaltyProgram.findOne({ ownerId, isActive: true }).lean();
    if (!program) return res.status(404).json({ success: false, valid: false, message: 'No active program.' });

    const codeDoc = program.discountCodes.find(c =>
      c.code === String(code).toUpperCase().trim() && c.isActive
    );
    if (!codeDoc) return res.status(404).json({ success: false, valid: false, message: 'Invalid or inactive code.' });

    if (codeDoc.expiresAt && new Date(codeDoc.expiresAt) < new Date())
      return res.status(400).json({ success: false, valid: false, message: 'Code has expired.' });

    if (codeDoc.maxUses > 0 && codeDoc.usedCount >= codeDoc.maxUses)
      return res.status(400).json({ success: false, valid: false, message: 'Code usage limit reached.' });

    return res.status(200).json({ success: true, valid: true, code: codeDoc });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Validation failed.' });
  }
};

// ─── GET CUSTOMER LOYALTY ─────────────────────────────────────────────────────
export const getCustomerLoyalty = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const [customers, total] = await Promise.all([
      CustomerLoyalty.find({ ownerId }).sort({ totalVisits: -1 }).skip(skip).limit(parseInt(limit)).lean(),
      CustomerLoyalty.countDocuments({ ownerId }),
    ]);

    return res.status(200).json({ success: true, data: customers, total });
  } catch (err) {
    return res.status(500).json({ success: false, message: 'Failed to load customers.' });
  }
};

// ─── AWARD POINTS / STAMPS (called when booking is completed) ─────────────────
export const awardLoyalty = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { customerEmail, customerName, customerPhone, spend = 0 } = req.body;

    if (!customerEmail)
      return res.status(400).json({ success: false, message: 'customerEmail required.' });

    const program = await LoyaltyProgram.findOne({ ownerId, isActive: true }).lean();
    if (!program) return res.status(200).json({ success: true, message: 'No active loyalty program.' });

    const update = {
      $inc: { totalVisits: 1, totalSpend: parseFloat(spend) || 0 },
      $set: { lastVisitAt: new Date(), customerName: customerName || 'Customer', customerPhone: customerPhone || '' },
    };

    if (program.mode === 'points') {
      update.$inc.points = program.pointsPerBooking;
    } else {
      update.$inc.stamps = 1;
    }

    const loyalty = await CustomerLoyalty.findOneAndUpdate(
      { ownerId, customerEmail: customerEmail.toLowerCase().trim() },
      update,
      { new: true, upsert: true }
    );

    return res.status(200).json({ success: true, data: loyalty });
  } catch (err) {
    console.error('[LOYALTY_AWARD_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to award loyalty.' });
  }
};

// ─── REDEEM ───────────────────────────────────────────────────────────────────
export const redeemLoyalty = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { customerEmail, type = 'points' } = req.body;

    const [program, loyalty] = await Promise.all([
      LoyaltyProgram.findOne({ ownerId }),
      CustomerLoyalty.findOne({ ownerId, customerEmail: customerEmail?.toLowerCase().trim() }),
    ]);

    if (!program || !program.isActive)
      return res.status(400).json({ success: false, message: 'No active loyalty program.' });
    if (!loyalty)
      return res.status(404).json({ success: false, message: 'Customer loyalty record not found.' });

    if (type === 'points') {
      if (loyalty.points < program.pointsToRedeem)
        return res.status(400).json({ success: false, message: `Not enough points. Need ${program.pointsToRedeem}, have ${loyalty.points}.` });
      loyalty.points -= program.pointsToRedeem;
      loyalty.redemptions.push({ type: 'points', amount: program.rewardValue, reward: `${program.rewardValue} ${program.rewardType === 'percent' ? '%' : 'TND'} discount` });
    } else {
      if (loyalty.stamps < program.stampsNeeded)
        return res.status(400).json({ success: false, message: `Not enough stamps. Need ${program.stampsNeeded}, have ${loyalty.stamps}.` });
      loyalty.stamps = 0;
      loyalty.redemptions.push({ type: 'stamps', reward: program.stampReward });
    }

    await loyalty.save();
    return res.status(200).json({ success: true, data: loyalty });
  } catch (err) {
    console.error('[LOYALTY_REDEEM_ERROR]', err.message);
    return res.status(500).json({ success: false, message: 'Failed to redeem.' });
  }
};

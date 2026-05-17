import User from '../models/User.js';
import { logActivity } from '../utils/activityLogger.js';

export const getKYCStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select('accountStatus kyc.status kyc.rejectionReason');
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });
    res.status(200).json({
      success: true,
      data: {
        accountStatus: user.accountStatus,
        kycStatus: user.kyc?.status,
        rejectionReason: user.kyc?.rejectionReason || null,
      },
    });
  } catch (err) {
    console.error('[KYC_STATUS_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to fetch KYC status.' });
  }
};

export const submitKYC = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) return res.status(404).json({ success: false, message: 'User not found.' });

    if (user.accountStatus === 'active') {
      return res.status(400).json({ success: false, message: 'Account is already verified.' });
    }
    if (user.accountStatus === 'review') {
      return res.status(400).json({ success: false, message: 'Your application is already under review.' });
    }

    const idFrontUrl    = req.files?.idFront?.[0]?.path;
    const idBackUrl     = req.files?.idBack?.[0]?.path;
    const livePhotoUrl  = req.files?.livenessVideo?.[0]?.path;

    if (!idFrontUrl || !idBackUrl || !livePhotoUrl) {
      return res.status(400).json({
        success: false,
        message: 'All three documents are required: ID front, ID back, and liveness video.',
      });
    }

    user.kyc = {
      status: 'pending',
      idFrontUrl,
      idBackUrl,
      livePhotoUrl,
      rejectionReason: null,
    };
    user.accountStatus = 'review';
    await user.save();

    logActivity(user._id, 'KYC_SUBMITTED', req);

    res.status(200).json({
      success: true,
      message: 'KYC documents submitted. Review expected within 24 hours.',
    });
  } catch (err) {
    console.error('[KYC_SUBMIT_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Failed to submit KYC documents.' });
  }
};

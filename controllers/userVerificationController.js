import User from '../models/User.js';
import { sendStatusEmail } from '../utils/emailService.js';

/**
 * 🛡️ ADMIN-ONLY: Review Professional KYC
 * Logic: Approves or Rejects a user, updates account status, 
 * and triggers automated email notifications.
 */
export const reviewUserIdentity = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  try {
    // 1. Fetch user and verify existence
    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ 
        success: false, 
        message: "Identity profile not found." 
      });
    }

    // 2. Prevent redundant reviews
    if (user.accountStatus === 'active' && action === 'approve') {
      return res.status(400).json({ message: "User is already active." });
    }

    // 3. Handle APPROVAL Logic
    if (action === 'approve') {
      user.accountStatus = 'active';
      user.kyc.status = 'verified';
      user.kyc.verifiedAt = new Date();
      user.kyc.rejectionReason = null; // Clear any past reasons

      // Ensure Onboarding Step is marked as completed
      user.onboardingStep = 5; 

      // Trigger Approval Email
      await sendStatusEmail(user.email, user.fullName, 'active');
    } 

    // 4. Handle REJECTION Logic
    else if (action === 'reject') {
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({
          message: "A detailed reason (min 10 chars) is required to notify the professional."
        });
      }

      user.accountStatus = 'rejected';
      user.kyc.status = 'rejected';
      user.kyc.rejectionReason = reason;

      await sendStatusEmail(user.email, user.fullName, 'rejected', reason);
    } 

    else {
      return res.status(400).json({ message: "Invalid action. Use 'approve' or 'reject'." });
    }

    // 5. Finalize and Audit
    await user.save();

    res.status(200).json({
      success: true,
      message: `System updated: Professional is now ${user.accountStatus}.`,
      status: user.accountStatus
    });

  } catch (error) {
    console.error("CRITICAL_KYC_ERROR:", error);
    res.status(500).json({ 
      success: false, 
      message: "Internal security failure during review processing." 
    });
  }
};

/**
 * 🔍 Fetch All Pending Verification Requests
 */
export const getPendingVerifications = async (req, res) => {
  try {
    const pendingUsers = await User.find({
      accountStatus: 'review',
      'kyc.status': 'pending'
    }).select('fullName email businessName category ville kyc profilePicUrl createdAt');

    res.status(200).json({
      success: true,
      count: pendingUsers.length,
      data: pendingUsers
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to retrieve pending list." });
  }
};
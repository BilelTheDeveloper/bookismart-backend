import User from '../../models/User.js';

/**
 * @desc    Get all merchants with pending KYC for verification
 * @route   GET /api/admin/user-verification/pending
 * @access  Private (Admin Only)
 */
export const getPendingVerifications = async (req, res) => {
  try {
    console.log("🔍 [Admin]: Fetching pending KYC requests...");

    // Find users who are 'owners' and have a 'pending' kyc status
    const pendingMerchants = await User.find({
      role: 'owner',
      'kyc.status': 'pending'
    })
    .select('-password') // Security: never send the hashed password to the UI
    .sort({ createdAt: -1 }); // Show newest first

    res.status(200).json(pendingMerchants);
  } catch (error) {
    console.error("🔥 [Admin Error]: Failed to fetch pending verifications:", error.message);
    res.status(500).json({ error: "Internal server error fetching merchants." });
  }
};

/**
 * @desc    Update KYC status (Verify or Reject)
 * @route   PATCH /api/admin/user-verification/verify/:id
 * @access  Private (Admin Only)
 */
export const updateVerificationStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body; // Expecting 'verified' or 'rejected'

    console.log(`⚖️ [Admin Action]: Processing ${status} for User ID: ${id}`);

    // 1. Validate status input
    if (!['verified', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'verified' or 'rejected'." });
    }

    // 2. Prepare update object
    const updateData = {
      'kyc.status': status,
      // If verified, the account becomes 'active'. If rejected, we keep it in 'review'
      accountStatus: status === 'verified' ? 'active' : 'review'
    };

    // 3. Update the database
    const user = await User.findByIdAndUpdate(
      id, 
      { $set: updateData }, 
      { new: true }
    ).select('-password');

    if (!user) {
      console.error("❌ [Admin Error]: Merchant not found");
      return res.status(404).json({ error: "Merchant not found." });
    }

    console.log(`✅ [Admin Success]: ${user.email} is now ${status}`);

    res.status(200).json({
      message: `Merchant has been successfully ${status}.`,
      user
    });

  } catch (error) {
    console.error("🔥 [Admin Critical Error]:", error.message);
    res.status(500).json({ error: "Internal server error during status update." });
  }
};
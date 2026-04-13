import Website from '../../models/Website.js';

/**
 * @desc    Get all websites pending admin audit
 * @route   GET /api/admin/web-verification/pending
 * @access  Private (Admin Only)
 */
export const getPendingWebsites = async (req, res) => {
  try {
    console.log("🔍 [Admin]: Fetching pending Website deployment requests...");

    // Find websites where verificationStatus is 'pending'
    // We populate owner info so the admin knows who created it
    const pendingSites = await Website.find({ verificationStatus: 'pending' })
      .populate('ownerId', 'fullName email businessName phone')
      .sort({ lastUpdated: -1 });

    res.status(200).json(pendingSites);
  } catch (error) {
    console.error("🔥 [Admin Error]: Failed to fetch pending websites:", error.message);
    res.status(500).json({ error: "Internal server error fetching pending websites." });
  }
};

/**
 * @desc    Update Website verification status (Approve or Reject)
 * @route   PATCH /api/admin/web-verification/status/:id
 * @access  Private (Admin Only)
 */
export const updateWebsiteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body; // status: 'approved' or 'rejected'

    console.log(`⚖️ [Admin Action]: Web Audit - ${status} for Site ID: ${id}`);

    // 1. Validate status input
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'." });
    }

    // 2. Prepare update object
    const updateData = {
      verificationStatus: status,
      rejectionReason: status === 'rejected' ? rejectionReason : "",
      // If approved, the site goes live
      isPublished: status === 'approved' ? true : false,
      lastUpdated: Date.now()
    };

    // 3. Update the database
    const updatedWebsite = await Website.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true }
    ).populate('ownerId', 'email businessName');

    if (!updatedWebsite) {
      return res.status(404).json({ error: "Website deployment record not found." });
    }

    console.log(`✅ [Admin Success]: Site ${updatedWebsite.slug} is now ${status}`);

    res.status(200).json({
      message: `Website has been successfully ${status}.`,
      website: updatedWebsite
    });

  } catch (error) {
    console.error("🔥 [Admin Critical Error]:", error.message);
    res.status(500).json({ error: "Internal server error during website audit." });
  }
};
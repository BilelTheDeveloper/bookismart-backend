import Website from '../../models/Website.js';

/**
 * @desc    Get all websites pending admin audit
 * @route   GET /api/admin/websites/pending
 * @access  Private (Admin Only)
 */
export const getPendingWebsites = async (req, res) => {
  try {
    console.log("🔍 [Admin]: Fetching pending Website deployment requests...");

    const pendingSites = await Website.find({ verificationStatus: 'pending' })
      .populate('ownerId', 'fullName email businessName phone profilePicUrl')
      .sort({ lastUpdated: -1 });

    res.status(200).json(pendingSites);
  } catch (error) {
    console.error("🔥 [Admin Error]: Failed to fetch pending websites:", error.message);
    res.status(500).json({ error: "Internal server error fetching pending websites." });
  }
};

/**
 * @desc    Get all approved websites (For Professionals/Marketplace Page)
 * @route   GET /api/admin/websites/approved
 * @access  Private (Admin Only)
 */
export const getApprovedWebsites = async (req, res) => {
  try {
    console.log("🌟 [Admin]: Fetching approved websites for marketplace...");

    // Find websites where verificationStatus is 'approved'
    const approvedSites = await Website.find({ verificationStatus: 'approved' })
      .populate('ownerId', 'fullName email businessName phone city profilePicUrl') 
      .sort({ lastUpdated: -1 });

    res.status(200).json(approvedSites);
  } catch (error) {
    console.error("🔥 [Admin Error]: Failed to fetch approved websites:", error.message);
    res.status(500).json({ error: "Internal server error fetching approved websites." });
  }
};

/**
 * @desc    Update Website verification status (Approve or Reject)
 * @route   PATCH /api/admin/websites/status/:id
 * @access  Private (Admin Only)
 */
export const updateWebsiteStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, rejectionReason } = req.body; 

    console.log(`⚖️ [Admin Action]: Web Audit - ${status} for Site ID: ${id}`);

    // 1. Validate status input
    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ error: "Invalid status. Must be 'approved' or 'rejected'." });
    }

    // 2. Prepare update object
    const updateData = {
      verificationStatus: status,
      rejectionReason: status === 'rejected' ? rejectionReason : "",
      // Important: isPublished is only true if status is exactly 'approved'
      isPublished: status === 'approved',
      lastUpdated: Date.now()
    };

    // 3. Update the database
    const updatedWebsite = await Website.findByIdAndUpdate(
      id,
      { $set: updateData },
      { new: true, runValidators: true }
    ).populate('ownerId', 'email businessName fullName');

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
import Website from '../models/Website.js';
import User from '../models/User.js';
import { sendStatusEmail } from '../utils/emailService.js';

/**
 * 👑 ADMIN-LEVEL WEBSITE COMPLIANCE 
 * Logic: Reviews merchant-built sites, handles publishing logic, 
 * and notifies the professional of the outcome.
 */

/**
 * @desc    Fetch all websites awaiting deployment review
 * @route   GET /api/admin/websites/pending
 * @access  Private (Admin Guard + Auth)
 */
export const getPendingWebsites = async (req, res) => {
  try {
    // 1. Fetch sites in 'pending' status, populating merchant details
    const pendingSites = await Website.find({ verificationStatus: 'pending' })
      .populate('ownerId', 'fullName email accountStatus kyc')
      .sort({ lastUpdated: -1 });

    res.status(200).json({
      success: true,
      count: pendingSites.length,
      data: pendingSites
    });
  } catch (error) {
    console.error(`🚨 [WEBSITE_QUEUE_FETCH_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: "Queue retrieval failed." });
  }
};

/**
 * @desc    Approve or Reject a Website (Deployment Review)
 * @route   PATCH /api/admin/websites/verify/:id
 * @access  Private (Admin Guard + Auth)
 */
export const reviewWebsiteDeployment = async (req, res) => {
  const { id } = req.params;
  const { action, reason } = req.body;

  try {
    // 1. Atomically fetch website and owner data
    const website = await Website.findById(id).populate('ownerId');
    
    if (!website) {
      return res.status(404).json({ success: false, message: "Website configuration not found." });
    }

    // 2. Integrity Check: Ensure merchant is still active before approving their site
    if (action === 'approve' && website.ownerId.accountStatus !== 'active') {
      return res.status(403).json({ 
        success: false, 
        message: "Action Blocked: Merchant must have active KYC status before site approval." 
      });
    }

    // 3. Handle APPROVAL (Launch Site)
    if (action === 'approve') {
      website.verificationStatus = 'approved';
      website.isPublished = true;
      website.rejectionReason = null;
      website.lastUpdated = Date.now();

      // Trigger Launch Email (Custom type 'site_live' for your email service)
      await sendStatusEmail(website.ownerId.email, website.ownerId.fullName, 'site_live');
    }

    // 4. Handle REJECTION (Send back for edits)
    else if (action === 'reject') {
      // Rule enforcement: Security & Clarity (Min 10 chars)
      if (!reason || reason.trim().length < 10) {
        return res.status(400).json({ 
          success: false,
          message: "A detailed rejection reason is required for merchant remediation." 
        });
      }

      website.verificationStatus = 'rejected';
      website.isPublished = false; // Immediately take offline if it was previously live
      website.rejectionReason = reason;
      website.lastUpdated = Date.now();

      // Trigger Revision Required Email
      await sendStatusEmail(website.ownerId.email, website.ownerId.fullName, 'site_rejected', reason);
    } 

    else {
      return res.status(400).json({ success: false, message: "Invalid action protocol." });
    }

    // 5. Secure Finalization
    await website.save();

    res.status(200).json({
      success: true,
      message: `Website protocol finalized: ${action.toUpperCase()}`,
      data: {
        slug: website.slug,
        isPublished: website.isPublished,
        status: website.verificationStatus
      }
    });

  } catch (error) {
    console.error(`🚨 [WEBSITE_VERIFICATION_CRASH]: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      message: "Internal Security Failure during deployment review." 
    });
  }
};
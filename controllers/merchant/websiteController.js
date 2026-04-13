import Website from '../../models/Website.js';

/**
 * @desc    Create or Update Merchant Website Data
 * @route   POST /api/merchant/website/save
 * @access  Private (Merchant/Owner Only)
 */
export const saveWebsiteData = async (req, res) => {
  try {
    const ownerId = req.user.id; // From your auth middleware
    const websiteData = req.body;

    console.log(`💾 [Merchant]: Saving website progress for Owner: ${ownerId}`);

    // We use findOneAndUpdate with "upsert: true" so it creates the site if it doesn't exist
    // or updates it if it does.
    const website = await Website.findOneAndUpdate(
      { ownerId: ownerId },
      { 
        ...websiteData, 
        ownerId,
        verificationStatus: 'pending', // Re-trigger pending status if they make major changes
        lastUpdated: Date.now() 
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      message: "Website progress saved successfully. Pending admin review.",
      website
    });
  } catch (error) {
    console.error("🔥 [Merchant Error]: Failed to save website:", error.message);
    res.status(500).json({ error: "Error saving your website configuration." });
  }
};

/**
 * @desc    Get current website configuration for the logged-in merchant
 * @route   GET /api/merchant/website/my-site
 * @access  Private (Merchant/Owner Only)
 */
export const getMyWebsite = async (req, res) => {
  try {
    const website = await Website.findOne({ ownerId: req.user.id });
    
    if (!website) {
      return res.status(404).json({ message: "No website configuration found. Start by picking a template!" });
    }

    res.status(200).json(website);
  } catch (error) {
    res.status(500).json({ error: "Internal server error fetching website data." });
  }
};
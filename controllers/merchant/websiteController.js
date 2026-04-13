import Website from '../../models/Website.js';

/**
 * @desc    Create or Update Merchant Website Data
 * @route   POST /api/merchant/website/save
 * @access  Private (Merchant/Owner Only)
 */
export const saveWebsiteData = async (req, res) => {
  try {
    const ownerId = req.user.id; 

    // 1. Handle incoming data structure
    // If you send FormData, sometimes JSON fields are strings. We parse them if needed.
    let websiteData = req.body;
    if (typeof req.body.data === 'string') {
      websiteData = JSON.parse(req.body.data);
    }

    console.log(`💾 [Merchant]: Processing website update for Owner: ${ownerId}`);

    // 2. Intercept Cloudinary Uploads
    // If files exist in the request, we overwrite the specific fields with Cloudinary URLs
    if (req.files) {
      // Hero Background Image
      if (req.files['heroImage'] && req.files['heroImage'][0]) {
        websiteData.hero = {
          ...websiteData.hero,
          backgroundImage: req.files['heroImage'][0].path
        };
      }

      // About Section Image
      if (req.files['aboutImage'] && req.files['aboutImage'][0]) {
        websiteData.about = {
          ...websiteData.about,
          image: req.files['aboutImage'][0].path
        };
      }

      // Gallery Images (Array)
      if (req.files['galleryImages']) {
        const uploadedGalleryUrls = req.files['galleryImages'].map(file => file.path);
        
        // If you want to replace old gallery images, use map. 
        // If you want to append, you'd spread the existing ones.
        websiteData.gallery = {
          ...websiteData.gallery,
          images: uploadedGalleryUrls,
          show: true
        };
      }
    }

    // 3. Database Operation
    // We maintain all existing fields but overwrite with new data and reset verification status
    const website = await Website.findOneAndUpdate(
      { ownerId: ownerId },
      { 
        ...websiteData, 
        ownerId,
        verificationStatus: 'pending', 
        isPublished: false, // Ensure it's not live until admin re-approves
        lastUpdated: Date.now() 
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      message: "Website configuration saved and images uploaded successfully.",
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
    console.error("🔥 [Fetch Error]:", error.message);
    res.status(500).json({ error: "Internal server error fetching website data." });
  }
};
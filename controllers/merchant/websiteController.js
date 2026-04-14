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
    // If sending FormData, the JSON payload usually comes in a 'data' field
    let websiteData = req.body;
    if (req.body.data && typeof req.body.data === 'string') {
      websiteData = JSON.parse(req.body.data);
    }

    console.log(`💾 [Merchant]: Processing website update for Owner: ${ownerId}`);

    // 2. Intercept Cloudinary Uploads
    // req.files is populated by the uploadCloudinary middleware
    if (req.files) {
      // Hero Background Image Update
      if (req.files['heroImage'] && req.files['heroImage'][0]) {
        // Ensure hero object exists before adding image
        websiteData.hero = {
          ...(websiteData.hero || {}),
          backgroundImage: req.files['heroImage'][0].path
        };
      }

      // About Section Image Update
      if (req.files['aboutImage'] && req.files['aboutImage'][0]) {
        // Ensure about object exists before adding image
        websiteData.about = {
          ...(websiteData.about || {}),
          image: req.files['aboutImage'][0].path
        };
      }

      // Gallery Images (Array)
      if (req.files['galleryImages'] && req.files['galleryImages'].length > 0) {
        const uploadedGalleryUrls = req.files['galleryImages'].map(file => file.path);
        
        // We replace the images array with the new Cloudinary URLs
        websiteData.gallery = {
          ...(websiteData.gallery || {}),
          images: uploadedGalleryUrls,
          show: true
        };
      }
    }

    // 3. Database Operation
    // Use findOneAndUpdate with upsert to create if it doesn't exist
    const website = await Website.findOneAndUpdate(
      { ownerId: ownerId },
      { 
        ...websiteData, 
        ownerId,
        verificationStatus: 'pending', // Reset status for Admin re-audit
        isPublished: false,           // Take offline until approved
        lastUpdated: Date.now() 
      },
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      message: "Website configuration and images saved successfully to Cloudinary.",
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
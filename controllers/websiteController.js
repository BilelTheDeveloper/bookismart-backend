import Website from '../models/Website.js';
import User from '../models/User.js';

/**
 * 🛡️ ADVANCED WEBSITE CONTROLLER (2026 Security Standards)
 */

/**
 * @desc    Get the merchant's current website configuration
 * @route   GET /api/merchant/website/my-site
 * @access  Private (Professional Only)
 */
export const getMyWebsite = async (req, res) => {
  try {
    // 1. Identify owner from the Triple-Lock Cookie (Decoded in Protect Middleware)
    const ownerId = req.user._id;

    const website = await Website.findOne({ ownerId });

    if (!website) {
      return res.status(404).json({ 
        message: "No configuration found. Start building your site." 
      });
    }

    res.status(200).json(website);
  } catch (error) {
    console.error(`🚨 [WEBSITE_FETCH_ERROR]: ${error.message}`);
    res.status(500).json({ message: "Secure retrieval failed." });
  }
};

/**
 * @desc    Save/Update Website with Whitelist Validation
 * @route   POST /api/merchant/website/save
 * @access  Private (Professional Only)
 */
export const saveWebsite = async (req, res) => {
  try {
    const ownerId = req.user._id;

    // 2. Security Check: Is the user account active?
    const user = await User.findById(ownerId);
    if (user.accountStatus === 'suspended') {
      return res.status(403).json({ message: "Action blocked: Account suspended." });
    }

    // 3. Data Whitelisting (Don't trust the req.body directly)
    const { 
      templateId, category, name, slug, 
      hero, about, services, gallery, 
      contact, businessHours 
    } = req.body;

    // 4. Advanced Slug Sanitization
    // We force the slug to be lowercase and replace spaces/special chars with dashes
    const sanitizedSlug = slug 
      ? slug.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-') 
      : `${name.toLowerCase().replace(/\s+/g, '-')}-${ownerId.toString().slice(-4)}`;

    // 5. Collision Check: Ensure the slug isn't stolen by another user
    const slugInUse = await Website.findOne({ 
      slug: sanitizedSlug, 
      ownerId: { $ne: ownerId } 
    });

    if (slugInUse) {
      return res.status(409).json({ message: "This URL (slug) is already taken." });
    }

    // 6. Advanced Upsert (Update or Insert)
    const updatePayload = {
      ownerId,
      templateId,
      category,
      name,
      slug: sanitizedSlug,
      hero,
      about,
      services,
      gallery,
      contact,
      businessHours,
      lastUpdated: Date.now(),
      // Reset verification status if the user changes their name or slug
      verificationStatus: 'pending' 
    };

    const website = await Website.findOneAndUpdate(
      { ownerId },
      updatePayload,
      { new: true, upsert: true, runValidators: true }
    );

    res.status(200).json({
      message: "Website secured and saved. Pending admin review.",
      slug: website.slug,
      isPublished: website.isPublished
    });

  } catch (error) {
    console.error(`🚨 [WEBSITE_SAVE_ERROR]: ${error.message}`);
    
    // Check for Mongoose Validation Errors (e.g., invalid enum for days)
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: "Data validation failed", 
        details: Object.values(error.errors).map(err => err.message) 
      });
    }

    res.status(500).json({ message: "Internal Security Error" });
  }
};
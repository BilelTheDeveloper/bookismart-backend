import Website from '../models/Website.js';
import User from '../models/User.js';

// 🌐 1. Get All Approved Websites for the Discovery Page
export const getDiscoveryFeed = async (req, res) => {
  try {
    const feed = await Website.find({ 
      verificationStatus: 'approved', 
      isPublished: true 
    })
    .populate('ownerId', 'fullName ville businessName category')
    .select('name slug category hero about ownerId')
    .sort({ lastUpdated: -1 });

    res.status(200).json({ success: true, data: feed });
  } catch (error) {
    res.status(500).json({ message: "Discovery feed offline." });
  }
};

// 🌐 2. Get Single Website by Slug (For the actual site visit)
export const getWebsiteBySlug = async (req, res) => {
  try {
    const { slug } = req.params;
    const website = await Website.findOne({ 
      slug: slug,
      verificationStatus: 'approved' // Security: Don't show unverified sites
    }).populate('ownerId', 'fullName ville category businessName');

    if (!website) {
      return res.status(404).json({ success: false, message: "Website not found or pending review." });
    }

    res.status(200).json({ success: true, data: website });
  } catch (error) {
    res.status(500).json({ message: "Error retrieving website profile." });
  }
};
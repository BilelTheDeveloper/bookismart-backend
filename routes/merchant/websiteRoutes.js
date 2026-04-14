import express from 'express';
// ✅ Import your pre-configured Cloudinary middleware
import uploadCloudinary from '../../utils/uploadCloudinary.js'; 
import { 
  saveWebsiteData, 
  getMyWebsite 
} from '../../controllers/merchant/websiteController.js';

// Auth middleware
import { protect, isOwner } from '../../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/merchant/website/my-site
 * @desc    Retrieve the current merchant's website configuration
 * @access  Private (Owner Only)
 */
router.get('/my-site', protect, isOwner, getMyWebsite);

/**
 * @route   POST /api/merchant/website/save
 * @desc    Create or update the website with Cloudinary image support
 * @access  Private (Owner Only)
 * * ✅ middleware logic:
 * - heroImage: Saved to Bookismart/Websites/Hero
 * - aboutImage: Saved to Bookismart/Websites/About
 * - galleryImages: Saved to Bookismart/Websites/Gallery
 */
router.post('/save', 
  protect, 
  isOwner, 
  uploadCloudinary.fields([
    { name: 'heroImage', maxCount: 1 },
    { name: 'aboutImage', maxCount: 1 },
    { name: 'galleryImages', maxCount: 10 }
  ]),
  saveWebsiteData
);

export default router;
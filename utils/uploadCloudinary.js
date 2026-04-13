import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

// Define the storage rules
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Dynamic folder selection based on field name
    let folderPath = 'Bookismart/General';
    
    // Auth & User Folders
    if (file.fieldname === 'profilePic') folderPath = 'Bookismart/Profiles';
    if (file.fieldname === 'shopLogo') folderPath = 'Bookismart/Shops';
    if (file.fieldname === 'kycDoc') folderPath = 'Bookismart/KYC_Docs';

    // ✅ NEW: Website Builder Specific Folders
    if (file.fieldname === 'heroImage') folderPath = 'Bookismart/Websites/Hero';
    if (file.fieldname === 'aboutImage') folderPath = 'Bookismart/Websites/About';
    if (file.fieldname === 'galleryImages') folderPath = 'Bookismart/Websites/Gallery';

    return {
      folder: folderPath,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'pdf'],
      // Only apply resizing transformations to images, leave PDFs alone
      transformation: file.mimetype.includes('image') 
        ? [{ width: 1200, height: 1200, crop: 'limit', quality: 'auto' }] 
        : [],
      public_id: `${Date.now()}-${file.originalname.split('.')[0]}`,
    };
  },
});

// The actual middleware you use in your routes
const uploadCloudinary = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Limit to 5MB
});

export default uploadCloudinary;
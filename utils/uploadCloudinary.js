import multer from 'multer';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import cloudinary from '../config/cloudinary.js';

// Define the storage rules
const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // Dynamic folder selection based on field name
    let folderPath = 'Bookismart/General';
    
    if (file.fieldname === 'profilePic') folderPath = 'Bookismart/Profiles';
    if (file.fieldname === 'shopLogo') folderPath = 'Bookismart/Shops';
    if (file.fieldname === 'kycDoc') folderPath = 'Bookismart/KYC_Docs';

    return {
      folder: folderPath,
      allowed_formats: ['jpg', 'png', 'jpeg', 'webp', 'pdf'],
      transformation: file.mimetype.includes('image') 
        ? [{ width: 800, height: 800, crop: 'limit', quality: 'auto' }] 
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
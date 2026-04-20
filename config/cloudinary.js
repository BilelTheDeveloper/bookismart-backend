import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// Configuration (Rule 1: Uses your live environment variables)
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // 1. Determine the folder based on file type
    let folder = 'bookiify/others';
    let allowedFormats = ['jpg', 'png', 'jpeg'];
    let resourceType = 'image';

    if (file.fieldname === 'idFront' || file.fieldname === 'idBack') {
      folder = 'bookiify/kyc-docs';
    } else if (file.fieldname === 'profilePic') {
      folder = 'bookiify/profiles';
    } else if (file.fieldname === 'livenessVideo') {
      folder = 'bookiify/liveness-videos';
      allowedFormats = ['webm', 'mp4'];
      resourceType = 'video'; // Critical for your 5s video
    }

    return {
      folder: folder,
      format: allowedFormats.includes(file.mimetype.split('/')[1]) 
               ? file.mimetype.split('/')[1] 
               : allowedFormats[0],
      resource_type: resourceType,
      public_id: `${file.fieldname}-${Date.now()}-${Math.round(Math.random() * 1E9)}`,
    };
  },
});

// 2. The Multer Middleware with Security Filters
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB Limit for the 5s Video
  },
  fileFilter: (req, file, cb) => {
    // Advanced Sanitization: Only allow specific mime types
    const allowedTypes = ['image/jpeg', 'image/png', 'video/webm', 'video/mp4'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only JPG, PNG, and WEBM/MP4 are allowed.'), false);
    }
  }
});

export default upload;
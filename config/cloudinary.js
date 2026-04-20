import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// Configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const storage = new CloudinaryStorage({
  cloudinary: cloudinary,
  params: async (req, file) => {
    // 1. Dynamic Resource Type detection
    // This ensures Cloudinary treats videos as videos and images as images
    const isVideo = file.fieldname === 'livenessVideo';
    
    let folder = 'bookiify/others';
    if (file.fieldname === 'idFront' || file.fieldname === 'idBack') {
      folder = 'bookiify/kyc-docs';
    } else if (file.fieldname === 'profilePic') {
      folder = 'bookiify/profiles';
    } else if (file.fieldname === 'livenessVideo') {
      folder = 'bookiify/liveness-videos';
    }

    return {
      folder: folder,
      resource_type: isVideo ? 'video' : 'image', // Critical fix
      // We use 'auto' or specific formats to prevent corruption
      format: isVideo ? 'mp4' : undefined, 
      public_id: `${file.fieldname}-${Date.now()}`,
      // Security: transformations to optimize files on upload
      transformation: isVideo 
        ? [{ quality: "auto", fetch_format: "auto" }] 
        : [{ width: 1200, crop: "limit", quality: "auto" }]
    };
  },
});

// 2. The Multer Middleware with Security Filters
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // Increased to 15MB for high-quality 5s videos
  },
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      'image/jpeg', 
      'image/png', 
      'image/jpg', 
      'video/webm', 
      'video/mp4', 
      'video/quicktime' // Added for iPhone users (MOV)
    ];
    
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported file type: ${file.mimetype}`), false);
    }
  }
});

export default upload;
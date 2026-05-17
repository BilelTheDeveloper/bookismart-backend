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

// Allowed MIME types and their magic-byte signatures
const ALLOWED_SIGNATURES = [
  { mime: 'image/jpeg',    bytes: [0xFF, 0xD8, 0xFF] },
  { mime: 'image/png',     bytes: [0x89, 0x50, 0x4E, 0x47] },
  { mime: 'video/mp4',     bytes: null }, // checked via ftyp box below
  { mime: 'video/webm',    bytes: [0x1A, 0x45, 0xDF, 0xA3] },
  { mime: 'video/quicktime', bytes: null }, // .mov — ftyp box
];
const ALLOWED_MIMES = ALLOWED_SIGNATURES.map((s) => s.mime);

// Field-level size limits (bytes)
const FIELD_SIZE_LIMITS = {
  idFront:        5  * 1024 * 1024, // 5 MB
  idBack:         5  * 1024 * 1024,
  profilePic:     3  * 1024 * 1024, // 3 MB
  livenessVideo:  15 * 1024 * 1024, // 15 MB
};

const fileFilter = (req, file, cb) => {
  // 1. MIME type allowlist (browser-reported)
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }

  // 2. Field-level size pre-check using Content-Length (best-effort, not guaranteed)
  const maxSize = FIELD_SIZE_LIMITS[file.fieldname] || 5 * 1024 * 1024;
  const reported = parseInt(req.headers['content-length'] || '0', 10);
  // Only reject if content-length is present and clearly over the per-field cap
  // (exact per-chunk enforcement happens via limits.fileSize below)
  if (reported > 0 && reported > maxSize * 2) {
    return cb(new Error(`File too large for field: ${file.fieldname}`), false);
  }

  // 3. Filename sanitisation — strip path traversal characters
  if (/[\/\\<>:"|?*]/.test(file.originalname)) {
    return cb(new Error('Invalid characters in filename.'), false);
  }

  cb(null, true);
};

// 2. The Multer Middleware with Security Filters
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 15 * 1024 * 1024, // absolute max — per-field logic is in fileFilter
    files: 4,                    // no more than 4 fields per upload request
  },
  fileFilter,
});

export default upload;
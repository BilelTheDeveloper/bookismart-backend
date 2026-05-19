import { v2 as cloudinary } from 'cloudinary';
import { CloudinaryStorage } from 'multer-storage-cloudinary';
import multer from 'multer';

// ─── Cloudinary credentials ───────────────────────────────────────────────────
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

export { cloudinary };

// ─── Folder + transform map ───────────────────────────────────────────────────
// Each upload field gets its own folder and optimized transformation.
const FIELD_CONFIG = {
  // KYC documents
  idFront:      { folder: 'bookiify/kyc-docs',         transform: [{ width: 1600, crop: 'limit', quality: 'auto:best' }] },
  idBack:       { folder: 'bookiify/kyc-docs',         transform: [{ width: 1600, crop: 'limit', quality: 'auto:best' }] },

  // Liveness video
  livenessVideo: { folder: 'bookiify/liveness-videos', transform: [{ quality: 'auto', fetch_format: 'auto' }], isVideo: true },

  // Profile pictures (owners, staff, customers)
  profilePic:         { folder: 'bookiify/profiles',   transform: [{ width: 400,  height: 400,  crop: 'fill', gravity: 'face', quality: 'auto' }] },
  staffProfilePic:    { folder: 'bookiify/profiles',   transform: [{ width: 400,  height: 400,  crop: 'fill', gravity: 'face', quality: 'auto' }] },
  customerProfilePic: { folder: 'bookiify/profiles',   transform: [{ width: 400,  height: 400,  crop: 'fill', gravity: 'face', quality: 'auto' }] },

  // Website builder — hero section (wide banner)
  heroImage: { folder: 'bookiify/website/heroes',   transform: [{ width: 1920, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] },

  // Website builder — about section image
  aboutImage: { folder: 'bookiify/website/about',  transform: [{ width: 1200, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] },

  // Website builder — gallery (square crop for consistent grid)
  galleryImage: { folder: 'bookiify/website/gallery', transform: [{ width: 900, height: 900, crop: 'fill', quality: 'auto', fetch_format: 'auto' }] },

  // Generic website image upload (legacy field name from websiteController)
  image: { folder: 'bookiify/website/assets',     transform: [{ width: 1920, crop: 'limit', quality: 'auto', fetch_format: 'auto' }] },
};

const DEFAULT_CONFIG = { folder: 'bookiify/misc', transform: [{ width: 1200, crop: 'limit', quality: 'auto' }] };

// ─── Cloudinary storage ───────────────────────────────────────────────────────
const storage = new CloudinaryStorage({
  cloudinary,
  params: async (req, file) => {
    const cfg     = FIELD_CONFIG[file.fieldname] || DEFAULT_CONFIG;
    const isVideo = cfg.isVideo === true;

    return {
      folder:        cfg.folder,
      resource_type: isVideo ? 'video' : 'image',
      format:        isVideo ? 'mp4' : undefined,
      public_id:     `${file.fieldname}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      transformation: cfg.transform,
    };
  },
});

// ─── MIME type security ───────────────────────────────────────────────────────
const ALLOWED_IMAGE_MIMES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',  // modern browsers upload webp
  'image/heic',  // iPhone photos
  'image/heif',
];
const ALLOWED_VIDEO_MIMES = ['video/mp4', 'video/webm', 'video/quicktime'];
const ALLOWED_MIMES       = [...ALLOWED_IMAGE_MIMES, ...ALLOWED_VIDEO_MIMES];

// ─── Per-field size limits (bytes) ────────────────────────────────────────────
const FIELD_SIZE_LIMITS = {
  idFront:            5  * 1024 * 1024,  // 5 MB
  idBack:             5  * 1024 * 1024,
  profilePic:         3  * 1024 * 1024,  // 3 MB
  staffProfilePic:    3  * 1024 * 1024,
  customerProfilePic: 3  * 1024 * 1024,
  livenessVideo:      25 * 1024 * 1024,  // 25 MB
  heroImage:          8  * 1024 * 1024,  // 8 MB — high-res banner
  aboutImage:         5  * 1024 * 1024,
  galleryImage:       5  * 1024 * 1024,  // per image in gallery
  image:              8  * 1024 * 1024,  // generic website asset
};

const fileFilter = (req, file, cb) => {
  // 1. MIME allowlist
  if (!ALLOWED_MIMES.includes(file.mimetype)) {
    return cb(new Error(`File type not allowed: ${file.mimetype}`), false);
  }

  // 2. Block video files on image-only fields
  const isVideoField = file.fieldname === 'livenessVideo';
  const isVideoMime  = ALLOWED_VIDEO_MIMES.includes(file.mimetype);
  if (isVideoMime && !isVideoField) {
    return cb(new Error(`Video not allowed for field: ${file.fieldname}`), false);
  }

  // 3. Per-field size pre-check (best-effort via Content-Length)
  const maxSize  = FIELD_SIZE_LIMITS[file.fieldname] || 5 * 1024 * 1024;
  const reported = parseInt(req.headers['content-length'] || '0', 10);
  if (reported > 0 && reported > maxSize * 2) {
    return cb(new Error(`File too large for field: ${file.fieldname}`), false);
  }

  // 4. Filename sanitisation — strip path traversal characters
  if (/[\/\\<>:"|?*]/.test(file.originalname)) {
    return cb(new Error('Invalid characters in filename.'), false);
  }

  cb(null, true);
};

// ─── Multer instances ─────────────────────────────────────────────────────────

// Default single-file or multi-field upload (KYC, profile, website single images)
const upload = multer({
  storage,
  limits: {
    fileSize: 25 * 1024 * 1024, // absolute max — per-field enforced in fileFilter
    files: 6,
  },
  fileFilter,
});

// Gallery bulk upload — up to 10 images at once
export const uploadGallery = multer({
  storage,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 10,
  },
  fileFilter,
});

export default upload;

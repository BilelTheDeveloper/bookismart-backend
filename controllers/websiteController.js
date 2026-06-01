import Website from '../models/Website.js';
import User from '../models/User.js';
import { validateWebsitePayload } from '../validators/websiteValidator.js';
import { cloudinary } from '../config/cloudinary.js';
import { bustPublic, bustPrivate } from '../middleware/cache.js';

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
 * @desc    Upload Image to Cloudinary (Handled by Multer Middleware)
 * @route   POST /api/merchant/website/upload
 * @access  Private (Professional Only)
 */
export const uploadWebsiteImage = async (req, res) => {
  try {
    // Single file upload (hero, about, generic)
    if (req.file) {
      return res.status(200).json({
        success: true,
        url:       req.file.path,
        public_id: req.file.filename,
      });
    }

    // Bulk gallery upload — req.files is an array
    if (req.files && req.files.length > 0) {
      const uploaded = req.files.map((f) => ({ url: f.path, public_id: f.filename }));
      return res.status(200).json({ success: true, files: uploaded });
    }

    return res.status(400).json({ success: false, message: 'No file uploaded or invalid file type.' });
  } catch (error) {
    console.error(`🚨 [IMAGE_UPLOAD_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Image processing failed.' });
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
    if (!user || user.accountStatus === 'suspended') {
      return res.status(403).json({ message: "Action blocked: Account suspended." });
    }

    // 3. Data Whitelisting (Don't trust the req.body directly)
    // At this stage, image URLs should already be permanent Cloudinary links
    const { error, value } = validateWebsitePayload(req.body);
    if (error) {
      return res.status(400).json({
        message: "Data validation failed",
        details: error.details.map((item) => item.message),
      });
    }

    const {
      templateId, category, name, slug,
      hero, about, services, gallery,
      beforeAfterGallery, team, teamSection,
      contact, businessHours, setupConfig
    } = value;

    // 4. Advanced Slug Sanitization
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
    // Use $set so that separately-managed fields (presentationReel, isPublished) are never wiped.
    const website = await Website.findOneAndUpdate(
      { ownerId },
      {
        $set: {
          ownerId,
          templateId,
          category,
          name,
          slug: sanitizedSlug,
          hero,
          about,
          services,
          gallery,
          beforeAfterGallery,
          team,
          teamSection,
          contact,
          businessHours,
          setupConfig,
          lastUpdated: Date.now(),
          verificationStatus: 'pending',
        },
      },
      { new: true, upsert: true, runValidators: true }
    );

    // Invalidate public site page, booking-info page, and owner's own config
    const uid = ownerId.toString();
    Promise.all([
      bustPublic('site', website.slug),  // public storefront (services/hours changed)
      bustPublic('bk-info', uid),        // booking info page (services/hours used there too)
      bustPrivate(uid, 'my-site'),       // owner's cached config in the builder
    ]).catch(() => {});

    res.status(200).json({
      message: "Website secured and saved. Pending admin review.",
      slug: website.slug,
      isPublished: website.isPublished
    });

  } catch (error) {
    console.error(`🚨 [WEBSITE_SAVE_ERROR]: ${error.message}`);
    
    if (error.name === 'ValidationError') {
      return res.status(400).json({ 
        message: "Data validation failed", 
        details: Object.values(error.errors).map(err => err.message) 
      });
    }

    res.status(500).json({ message: "Internal Security Error" });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// SAVE SECTION BUILDER (Shopify-style dynamic site)
// @route  POST /api/merchant/website/builder
// @access Private
// ─────────────────────────────────────────────────────────────────────────────
const ALLOWED_SECTION_TYPES = ['hero', 'about', 'services', 'team', 'stats', 'gallery', 'cta', 'contact'];

export const saveBuilder = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const { name, sections, builderTheme } = req.body;

    if (!Array.isArray(sections)) {
      return res.status(400).json({ success: false, message: 'Invalid sections payload.' });
    }
    if (sections.length > 40) {
      return res.status(400).json({ success: false, message: 'Too many sections (max 40).' });
    }
    // Light sanitation: keep only known section shapes.
    const cleanSections = sections
      .filter((s) => s && typeof s === 'object' && ALLOWED_SECTION_TYPES.includes(s.type))
      .slice(0, 40)
      .map((s) => ({
        id: String(s.id || '').slice(0, 60),
        type: s.type,
        visible: s.visible !== false,
        settings: (s.settings && typeof s.settings === 'object') ? s.settings : {},
      }));

    const theme = {
      accent: typeof builderTheme?.accent === 'string' ? builderTheme.accent.slice(0, 9) : '#6366f1',
      mode: builderTheme?.mode === 'light' ? 'light' : 'dark',
    };

    const user = await User.findById(ownerId).select('businessName category');
    const baseName = (name || user?.businessName || 'my-site').toString().slice(0, 120);
    const slug = `${baseName.toLowerCase().trim().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'site'}-${ownerId.toString().slice(-4)}`;

    const website = await Website.findOneAndUpdate(
      { ownerId },
      {
        $set: {
          name: baseName,
          sections: cleanSections,
          builderTheme: theme,
          useBuilder: true,
          verificationStatus: 'pending',
          lastUpdated: Date.now(),
        },
        $setOnInsert: {
          ownerId,
          slug,
          templateId: 'BUILDER',
          category: user?.category || 'Organization',
        },
      },
      { new: true, upsert: true, runValidators: true }
    );

    const uid = ownerId.toString();
    Promise.all([
      bustPublic('site', website.slug),
      bustPublic('bk-info', uid),
      bustPrivate(uid, 'my-site'),
    ]).catch(() => {});

    res.json({ success: true, slug: website.slug, sections: website.sections.length });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'That site URL is already taken.' });
    }
    console.error(`🚨 [SAVE_BUILDER_ERROR]: ${error.message}`);
    res.status(500).json({ success: false, message: 'Could not save your site.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// UPLOAD PRESENTATION REEL
// @route  POST /api/merchant/website/upload/reel
// @access Private
// ─────────────────────────────────────────────────────────────────────────────
export const uploadPresentationReel = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file uploaded.' });
    }

    const ownerId = req.user._id;

    // Enforce 30-second limit via Cloudinary metadata
    // Cloudinary returns duration in the response — check it
    const duration = req.file.resource_type === 'video' ? null : null;
    // Note: multer-storage-cloudinary doesn't expose duration directly.
    // We fetch it from the Cloudinary API after upload.
    let videoDuration = 0;
    try {
      const info = await cloudinary.api.resource(req.file.filename, { resource_type: 'video' });
      videoDuration = info.duration || 0;
    } catch {
      // Non-fatal — continue even if we can't fetch duration
    }

    if (videoDuration > 32) {
      // Delete the just-uploaded file — it's too long
      await cloudinary.uploader.destroy(req.file.filename, { resource_type: 'video' }).catch(() => {});
      return res.status(400).json({
        success: false,
        message: `Video is too long (${Math.round(videoDuration)}s). Maximum is 30 seconds.`,
      });
    }

    // Delete previous reel if it exists
    const existing = await Website.findOne({ ownerId }).select('presentationReel slug');
    if (existing?.presentationReel?.publicId) {
      await cloudinary.uploader.destroy(existing.presentationReel.publicId, { resource_type: 'video' }).catch(() => {});
    }

    // Save reference to website doc
    await Website.findOneAndUpdate(
      { ownerId },
      {
        'presentationReel.show':     true,
        'presentationReel.videoUrl': req.file.path,
        'presentationReel.publicId': req.file.filename,
        lastUpdated: Date.now(),
      },
      { upsert: true }
    );

    // Invalidate public site and owner's cached config
    const uid = ownerId.toString();
    Promise.all([
      existing?.slug ? bustPublic('site', existing.slug) : Promise.resolve(),
      bustPrivate(uid, 'my-site'),
    ]).catch(() => {});

    res.status(200).json({
      success: true,
      url:      req.file.path,
      publicId: req.file.filename,
      duration: Math.round(videoDuration),
    });
  } catch (err) {
    console.error('[REEL_UPLOAD_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Reel upload failed.' });
  }
};

// ─────────────────────────────────────────────────────────────────────────────
// DELETE PRESENTATION REEL
// @route  DELETE /api/merchant/website/upload/reel
// @access Private
// ─────────────────────────────────────────────────────────────────────────────
export const deletePresentationReel = async (req, res) => {
  try {
    const ownerId = req.user._id;
    const site = await Website.findOne({ ownerId }).select('presentationReel slug');

    if (site?.presentationReel?.publicId) {
      await cloudinary.uploader.destroy(site.presentationReel.publicId, { resource_type: 'video' }).catch(() => {});
    }

    await Website.findOneAndUpdate(
      { ownerId },
      {
        'presentationReel.show':     false,
        'presentationReel.videoUrl': '',
        'presentationReel.publicId': '',
      }
    );

    // Invalidate public site and owner's cached config
    const uid = ownerId.toString();
    Promise.all([
      site?.slug ? bustPublic('site', site.slug) : Promise.resolve(),
      bustPrivate(uid, 'my-site'),
    ]).catch(() => {});

    res.status(200).json({ success: true, message: 'Reel removed.' });
  } catch (err) {
    console.error('[REEL_DELETE_ERROR]', err.message);
    res.status(500).json({ success: false, message: 'Reel deletion failed.' });
  }
};
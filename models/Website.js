import mongoose from 'mongoose';

const WebsiteSchema = new mongoose.Schema({
  // --- 1. OWNERSHIP & ROUTING ---
  ownerId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User', 
    required: true 
  },
  slug: { 
    type: String, 
    unique: true, 
    required: true,
    lowercase: true,
    trim: true 
  }, // e.g., "vogue-studio-tunis"
  
  templateId: { 
    type: String, 
    required: true 
  }, // e.g., "BARBER_THEME_01" or "SPA_THEME_LUXURY"

  category: {
    type: String,
    required: true
  }, // e.g., "barbershops", "spas"

  // --- 1b. SECTION BUILDER (Shopify-style dynamic site) ---
  // When useBuilder is true, the public site renders `sections` (ordered JSON)
  // with `builderTheme`, instead of a fixed template component.
  name: { type: String, default: '' },
  useBuilder: { type: Boolean, default: false },
  builderTheme: {
    accent: { type: String, default: '#6366f1' },
    mode:   { type: String, enum: ['dark', 'light'], default: 'dark' },
  },
  sections: [{ type: mongoose.Schema.Types.Mixed }],

  // --- 2. HERO SECTION ---
  hero: {
    title: { type: String, default: "" },
    slogan: { type: String, default: "" },
    backgroundImage: { type: String, default: "" }
  },

  // --- 3. ABOUT SECTION ---
  about: {
    show: { type: Boolean, default: true },
    title: { type: String, default: "Our Story" },
    text: { type: String, default: "" },
    image: { type: String, default: "" }
  },

  // --- 4. SERVICES SECTION ---
  services: [{
    title: { type: String, required: true },
    description: { type: String },
    price: { type: String },
    duration: { type: Number, default: 30, min: 5, max: 480 }, // Minutes
    bufferTime: { type: Number, default: 0, min: 0, max: 120 }, // Cleanup/prep minutes after service
    active: { type: Boolean, default: true }
  }],

  // --- 4b. TEAM SECTION (organization templates) ---
  // Showcases the organization's practitioners/staff on the public site.
  teamSection: {
    show:     { type: Boolean, default: true },
    title:    { type: String, default: "Meet Our Team" },
    subtitle: { type: String, default: "The experts behind our work" },
  },
  team: [{
    name:        { type: String, required: true, trim: true },
    role:        { type: String, default: "", trim: true },
    photo:       { type: String, default: "" },
    bio:         { type: String, default: "", maxlength: 300 },
    specialties: [{ type: String, trim: true }],
    socials: {
      instagram: { type: String, default: "" },
      linkedin:  { type: String, default: "" },
    },
  }],

  // --- 5. PRESENTATION REEL ---
  // A short showcase video (max 30s) the owner can optionally add.
  // Shown as a dedicated autoplay section on the public profile.
  presentationReel: {
    show:      { type: Boolean, default: false },
    videoUrl:  { type: String,  default: '' },
    publicId:  { type: String,  default: '' },   // Cloudinary public_id for deletion
    title:     { type: String,  default: 'Notre savoir-faire en vidéo' },
    subtitle:  { type: String,  default: '' },
  },

  // --- 6. GALLERY SECTION ---
  gallery: {
    show: { type: Boolean, default: true },
    images: [{ type: String }]
  },

  // --- 6b. BEFORE / AFTER GALLERY ---
  beforeAfterGallery: [{
    before:  { type: String, default: '' },
    after:   { type: String, default: '' },
    caption: { type: String, default: '', maxlength: 120 },
  }],

  // --- 6. FOOTER & SOCIALS ---
  contact: {
    phone: { type: String },
    email: { type: String },
    address: { type: String },
    socials: {
      instagram: { type: String },
      facebook: { type: String },
      tiktok: { type: String }
    }
  },

  // --- 7. DETAILED WORKING HOURS ---
  businessHours: [{
    day: { 
      type: String, 
      enum: ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'] 
    },
    open: { type: String, default: "09:00" },
    close: { type: String, default: "19:00" },
    isClosed: { type: Boolean, default: false } // For "Closed on Sundays"
  }],

  // --- 8. SEASONAL HOURS OVERRIDES ---
  seasonalHours: [{
    label: { type: String, default: 'Special Hours', trim: true },
    startDate: { type: String, required: true }, // "YYYY-MM-DD"
    endDate:   { type: String, required: true }, // "YYYY-MM-DD"
    isClosed:  { type: Boolean, default: false },
    open:      { type: String, default: '09:00' },
    close:     { type: String, default: '18:00' },
  }],

  // --- 9. BOOKING & LOCALIZATION SETTINGS ---
  setupConfig: {
    maxCustomersPerDay: { type: Number, default: 25, min: 1, max: 500 },
    restMinutesBetweenConsultations: { type: Number, default: 0, min: 0, max: 180 },
    pauseWindows: [{
      label: { type: String, default: "Pause", trim: true },
      start: { type: String, default: "12:00" },
      end: { type: String, default: "13:00" }
    }],
    localization: {
      country: { type: String, default: "", trim: true },
      city: { type: String, default: "", trim: true },
      address: { type: String, default: "", trim: true },
      timezone: { type: String, default: "UTC" }
    }
  },

  // --- 9. STATUS & VERIFICATION ---
  isPublished: { type: Boolean, default: false },
  verificationStatus: { 
    type: String, 
    enum: ['pending', 'approved', 'rejected'], 
    default: 'pending' 
  },
  rejectionReason: { type: String, default: "" },
  lastUpdated: { type: Date, default: Date.now }
});

// Create an index for the slug to make searching super fast
WebsiteSchema.index({ slug: 1 });

const Website = mongoose.model('Website', WebsiteSchema);
export default Website;
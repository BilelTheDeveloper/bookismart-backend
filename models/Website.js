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
    price: { type: String }, // String to allow "Starting at 20 TND" or "Free"
    active: { type: Boolean, default: true }
  }],

  // --- 5. GALLERY SECTION ---
  gallery: {
    show: { type: Boolean, default: true },
    images: [{ type: String }] // Array of Cloudinary/S3 URLs
  },

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

  // --- 8. BOOKING & LOCALIZATION SETTINGS ---
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
import Joi from 'joi';

// 1. Exact list from your User Model to prevent "City Injection"
const tunisianCities = [
  "Ariana", "Beja", "Ben Arous", "Bizerte", "Gabes", "Gafsa", 
  "Jendouba", "Kairouan", "Kasserine", "Kebili", "Kef", "Mahdia", 
  "Manouba", "Medenine", "Monastir", "Nabeul", "Sfax", "Sidi Bouzid", 
  "Siliana", "Sousse", "Tataouine", "Tozeur", "Tunis", "Zaghouan"
];

// 2. Exact categories from your User Model
const businessCategories = [
  "Beauty & Barbers", "Health & Medical", "Fitness & Gyms", 
  "Creative & Media", "Car Services", "Maintenance", 
  "Coaching & Tutors", "Consultants", "Events & DJs", "Grooming & Vets"
];

/**
 * Validates the 5-Step Signup Data
 * Sanitizes input (lowercase, trim) automatically
 */
export const validateSignup = (data) => {
  const schema = Joi.object({
    fullName: Joi.string().min(3).max(50).required().trim(),
    email: Joi.string().email().required().lowercase().trim(),
    phone: Joi.string().pattern(/^[0-9]{8,12}$/).required(),
    businessName: Joi.string().min(2).required().trim(),
    category: Joi.string().valid(...businessCategories).required(),
    ville: Joi.string().valid(...tunisianCities).required(),

    // --- ACCOUNT TYPE (Individual vs Organization) ---
    accountType: Joi.string().valid('individual', 'organization').optional(),
    organizationName: Joi.string().allow('').max(80).optional().trim(),
    branchCount: Joi.number().integer().min(1).max(500).optional(),
    teamSize: Joi.number().integer().min(1).max(10000).optional(),
    
    // Password Rule: Min 8 chars, 1 Upper, 1 Lower, 1 Number
    password: Joi.string()
      .min(8)
      .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])'))
      .required()
      .messages({
        'string.pattern.base': 'Password must contain at least one uppercase letter, one lowercase letter, and one number.'
      }),

    // --- FIX FOR 400 ERROR: Allow file keys in the request body ---
    // These are processed by Multer, but Joi must allow them to exist 
    // in the body to avoid the "field not allowed" rejection.
    idFront: Joi.any().optional(),
    idBack: Joi.any().optional(),
    livenessVideo: Joi.any().optional(),
    profilePic: Joi.any().optional()
  });

  return schema.validate(data, { abortEarly: false }); // Returns ALL errors found
};

/**
 * Validates Login credentials
 */
export const validateLogin = (data) => {
  const schema = Joi.object({
    email: Joi.string().email().required().lowercase().trim(),
    password: Joi.string().required()
  });
  return schema.validate(data);
};
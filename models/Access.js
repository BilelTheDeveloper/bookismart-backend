import mongoose from 'mongoose';
import bcrypt from 'bcrypt';
import { v4 as uuidv4 } from 'uuid';

const adminSchema = new mongoose.Schema({
  _id: { 
    type: String, 
    default: uuidv4 
  },
  fullName: { 
    type: String, 
    required: true,
    trim: true 
  },
  email: { 
    type: String, 
    required: true, 
    unique: true, 
    lowercase: true 
  },
  passwordHash: { 
    type: String, 
    required: true 
  },
  accessLevel: { 
    type: String, 
    enum: ['admin', 'support', 'moderator'],
    default: 'moderator' 
  },
  secretKey: { 
    type: String, 
    default: null 
  },
  isActive: { 
    type: Boolean, 
    default: true 
  },
  lastLogin: { 
    type: Date, 
    default: null 
  }
}, { 
  timestamps: true // Automatically creates createdAt and updatedAt
});

/**
 * Password Hashing Middleware
 * Automatically hashes the password before saving to the database.
 */
adminSchema.pre('save', async function(next) {
  if (!this.isModified('passwordHash')) return next();
  try {
    const salt = await bcrypt.genSalt(12);
    this.passwordHash = await bcrypt.hash(this.passwordHash, salt);
    next();
  } catch (err) {
    next(err);
  }
});

/**
 * Helper Method: Compare Password
 * Use this during login to check the password hash.
 */
adminSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.passwordHash);
};

// Renamed model to Admin to match your existing tags
const Admin = mongoose.model('Admin', adminSchema);

export default Admin;
import Admin from '../../models/Access.js';
import jwt from 'jsonwebtoken';

/**
 * @desc    Create a new admin/moderator (Grant Access)
 * @route   POST /api/v1/admin/access/grant
 * @access  Private (Only 'admin' can grant access)
 */
export const grantAccess = async (req, res) => {
  try {
    const { fullName, email, password, accessLevel, secretKey } = req.body;

    // 1. Check if the admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      return res.status(400).json({ message: "This email already has system access." });
    }

    // 2. Create the new admin (password hashing is handled in the model middleware)
    const newAdmin = await Admin.create({
      fullName,
      email,
      passwordHash: password, // The pre-save hook in your model will hash this
      accessLevel,
      secretKey,
      isActive: true
    });

    res.status(201).json({
      success: true,
      message: `Access granted successfully as ${accessLevel}`,
      data: {
        id: newAdmin._id,
        fullName: newAdmin.fullName,
        email: newAdmin.email,
        accessLevel: newAdmin.accessLevel
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Server Error", error: error.message });
  }
};

/**
 * @desc    Admin Login Logic
 * @route   POST /api/v1/admin/access/login
 * @access  Public
 */
export const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Find admin and check if active
    const admin = await Admin.findOne({ email });
    if (!admin || !admin.isActive) {
      return res.status(401).json({ message: "Invalid credentials or account disabled." });
    }

    // 2. Compare password (using the helper method we added to the model)
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ message: "Invalid credentials." });
    }

    // 3. Update last login timestamp
    admin.lastLogin = Date.now();
    await admin.save();

    // 4. Generate JWT Token
    const token = jwt.sign(
      { id: admin._id, accessLevel: admin.accessLevel },
      process.env.JWT_SECRET || 'your_fallback_secret',
      { expiresIn: '12h' }
    );

    // ✅ Added 'role: admin' to the response to prevent frontend auth conflicts
    res.status(200).json({
      success: true,
      token,
      admin: {
        id: admin._id,
        fullName: admin.fullName,
        email: admin.email,
        accessLevel: admin.accessLevel,
        role: 'admin' 
      }
    });
  } catch (error) {
    res.status(500).json({ message: "Login failed", error: error.message });
  }
};

/**
 * @desc    Get all admins (For the Access Control UI)
 * @route   GET /api/v1/admin/access/list
 * @access  Private (Admin only)
 */
export const getAllAdmins = async (req, res) => {
  try {
    const admins = await Admin.find().select('-passwordHash -secretKey');
    res.status(200).json({ success: true, admins });
  } catch (error) {
    res.status(500).json({ message: "Error fetching admin list" });
  }
};

/**
 * @desc    Kill Access (Deactivate Admin)
 * @route   PATCH /api/v1/admin/access/toggle/:id
 * @access  Private (Admin only)
 */
export const toggleAdminStatus = async (req, res) => {
  try {
    const admin = await Admin.findById(req.params.id);
    if (!admin) return res.status(404).json({ message: "Admin not found" });

    // Prevent deactivating yourself (Safety Lock)
    if (admin.email === req.user.email) {
      return res.status(400).json({ message: "You cannot deactivate your own account." });
    }

    admin.isActive = !admin.isActive;
    await admin.save();

    res.status(200).json({ 
      success: true, 
      message: `Admin is now ${admin.isActive ? 'Active' : 'Deactivated'}` 
    });
  } catch (error) {
    res.status(500).json({ message: "Toggle failed" });
  }
};
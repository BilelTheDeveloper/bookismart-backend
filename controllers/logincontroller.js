import User from '../models/User.js';
import bcrypt from 'bcryptjs'; // Using bcryptjs for consistency with your step3
import jwt from 'jsonwebtoken';

/**
 * @desc    Authenticate user & get token
 * @route   POST /api/auth/login
 * @access  Public
 */
export const loginController = async (req, res) => {
  try {
    const { email, password } = req.body;

    // 1. Find user by email
    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ error: "No account found with this email." });
    }

    // 2. Check Account Status
    // Only 'active' users can log into the dashboard. 
    // If they are 'on_boarding' or 'review', we block entry.
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ 
        error: `Login restricted. Your account is currently: ${user.accountStatus.replace('_', ' ')}. Please contact support or wait for Admin approval.` 
      });
    }

    // 3. Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid password. Please try again." });
    }

    // 4. Update Last Login Date (Good for tracking active merchants)
    user.lastLogin = new Date();
    await user.save();

    // 5. Generate JWT Token
    // We include the ID and Role so the frontend knows where to redirect them
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' } // Token lasts for 24 hours
    );

    // 6. Prepare user data for Frontend
    // This includes the profilePicUrl we saved to Cloudinary during registration
    const userData = user.toObject();
    delete userData.password;
    delete userData.otpCodes; // Remove sensitive OTP data if it exists

    res.status(200).json({
      success: true,
      token,
      user: userData,
      message: `Welcome back, ${user.fullName}!`
    });

  } catch (error) {
    console.error("🔥 Login Controller Error:", error.message);
    res.status(500).json({ error: "Internal server error during login." });
  }
};
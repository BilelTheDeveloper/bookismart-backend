import User from '../models/User.js';
import bcrypt from 'bcryptjs'; 
import jwt from 'jsonwebtoken';

/**
 * @desc    Authenticate user & get token via HttpOnly Cookie
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
    if (user.accountStatus !== 'active') {
      return res.status(403).json({ 
        error: `Login restricted. Your account is currently: ${user.accountStatus.replace('_', ' ')}. Please contact support.` 
      });
    }

    // 3. Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(400).json({ error: "Invalid password. Please try again." });
    }

    // 4. Update Last Login Date
    user.lastLogin = new Date();
    await user.save();

    // 5. Generate JWT Token
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' } 
    );

    // ✅ 6. Set HttpOnly Cookie (FIXED FOR RENDER/VERCEL)
    res.cookie('token', token, {
      httpOnly: true, 
      // 🛡️ CRITICAL FIX: 
      // In production (Render/Vercel), we MUST use secure: true and sameSite: 'none'
      // because the frontend and backend have different URLs.
      secure: true, 
      sameSite: 'none', 
      maxAge: 24 * 60 * 60 * 1000 
    });

    // 7. Prepare user data for Frontend
    const userData = user.toObject();
    delete userData.password;
    delete userData.otpCodes; 

    res.status(200).json({
      success: true,
      user: userData,
      message: `Welcome back, ${user.fullName}!`
    });

  } catch (error) {
    console.error("🔥 Login Controller Error:", error.message);
    res.status(500).json({ error: "Internal server error during login." });
  }
};
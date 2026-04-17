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

    // 1. Validation: Ensure fields are not empty
    if (!email || !password) {
      return res.status(400).json({ error: "Please provide both email and password." });
    }

    // 2. Find user & explicitly include sensitive fields if they were deselected by default
    const user = await User.findOne({ email: email.toLowerCase() });
    
    if (!user) {
      // 🛡️ Security Tip: Use generic messages in production to prevent email enumeration
      return res.status(401).json({ error: "Invalid credentials. Please try again." });
    }

    // 3. Account Status Check (Synchronized with your Model)
    // Admins can bypass 'review' or 'on_boarding' if necessary, 
    // but typically 'active' is the required state for all.
    const allowedStatuses = ['active'];
    if (user.role !== 'admin' && !allowedStatuses.includes(user.accountStatus)) {
      return res.status(403).json({ 
        error: `Access restricted. Your account is currently ${user.accountStatus.replace('_', ' ')}.`,
        status: user.accountStatus 
      });
    }

    // 4. Verify Password
    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({ error: "Invalid credentials. Please try again." });
    }

    // 5. Generate JWT Token
    // We include the role and id to make the Middleware 'protect' faster
    const token = jwt.sign(
      { id: user._id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1d' } 
    );

    // 6. Security Header: Prevent Mime-Sniffing & Clickjacking
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // ✅ 7. Set HttpOnly Cookie (Optimized for Vercel + Render)
    const isProduction = process.env.NODE_ENV === 'production' || req.get('host').includes('onrender.com');

    res.cookie('token', token, {
      httpOnly: true, // 🚫 Prevents XSS (JavaScript cannot access the token)
      secure: true,   // 🔒 Required for sameSite: 'none'
      sameSite: 'none', // 🌍 Allows Cross-Domain (Vercel to Render)
      maxAge: 24 * 60 * 60 * 1000, // 1 Day
      path: '/',      // Cookie available across the whole site
    });

    // 8. Update Analytics/Metadata
    user.lastLogin = new Date();
    // Use findByIdAndUpdate to avoid triggering 'save' middlewares if not needed
    await User.findByIdAndUpdate(user._id, { lastLogin: user.lastLogin });

    // 9. Clean User Data for Response
    const userData = user.toObject();
    delete userData.password;
    delete userData.otpCodes;
    delete userData.__v;

    // 10. Send Response
    console.log(`✅ [Auth Success]: ${user.role.toUpperCase()} logged in: ${user.email}`);
    
    res.status(200).json({
      success: true,
      user: userData,
      message: `Welcome back, ${user.fullName}!`
    });

  } catch (error) {
    console.error("🔥 [Login Critical Error]:", error.message);
    res.status(500).json({ error: "A server error occurred during login. Please try again later." });
  }
};
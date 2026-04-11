import User from '../../models/User.js';
import bcrypt from 'bcryptjs';

const step3Security = async (req, res) => {
  try {
    const { userId, password, confirmPassword } = req.body;

    console.log(`🚀 [Step 3]: Setting password for User ID: ${userId}`);

    // 1. Basic Validation
    if (!userId || !password || !confirmPassword) {
      console.error("❌ [Step 3 Error]: Missing required security fields");
      return res.status(400).json({ error: "Please provide and confirm your password." });
    }

    // 2. Password Match Check
    if (password !== confirmPassword) {
      console.warn("⚠️ [Step 3 Fail]: Passwords do not match");
      return res.status(400).json({ error: "Passwords do not match." });
    }

    // 3. Complexity Validation (Sync with your Frontend Checklist)
    const hasNumber = /[0-9]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const isLongEnough = password.length >= 8;

    if (!hasNumber || !hasUpper || !isLongEnough) {
      console.warn("⚠️ [Step 3 Fail]: Password does not meet security requirements");
      return res.status(400).json({ 
        error: "Password must be 8+ characters with at least one number and one uppercase letter." 
      });
    }

    // 4. Find User
    const user = await User.findById(userId);
    if (!user) {
      console.error("❌ [Step 3 Error]: User not found");
      return res.status(404).json({ error: "Account session not found." });
    }

    // 5. Hash Password
    console.log("🔐 [Step 3]: Hashing password...");
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    // 6. Update User
    user.password = hashedPassword;
    // We update the accountStatus to signify they finished the security part
    user.accountStatus = 'on_boarding'; 
    
    await user.save();

    console.log("✅ [Step 3 Success]: Password secured for user:", user.email);

    res.status(200).json({
      message: "Password set successfully.",
      nextStep: 4
    });

  } catch (error) {
    console.error("🔥 [Step 3 Critical Error]:", error.message);
    res.status(500).json({ error: "Internal server error while securing account." });
  }
};

export default step3Security;

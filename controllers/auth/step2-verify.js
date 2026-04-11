import User from '../../models/User.js';

const step2Verify = async (req, res) => {
  try {
    const { userId, phoneOtp, emailOtp } = req.body;

    console.log(`🚀 [Step 2]: Verifying OTPs for User ID: ${userId}`);

    // 1. Basic Validation
    if (!userId || !phoneOtp || !emailOtp) {
      console.error("❌ [Step 2 Error]: Missing userId or OTP codes");
      return res.status(400).json({ error: "Please enter both verification codes." });
    }

    // 2. Find User
    const user = await User.findById(userId);
    if (!user) {
      console.error("❌ [Step 2 Error]: User not found in database");
      return res.status(404).json({ error: "Session expired. Please start over." });
    }

    // 3. Check if OTPs have expired
    // Note: We skip this check if the user is using the master code '000000'
    const isMasterCode = phoneOtp === "000000" && emailOtp === "000000";

    if (!isMasterCode && user.otpCodes.expiresAt && user.otpCodes.expiresAt < Date.now()) {
      console.warn("⚠️ [Step 2 Warning]: OTP codes have expired");
      return res.status(410).json({ error: "Codes have expired. Please request new ones." });
    }

    // 4. Verify Phone OTP (Accepts stored OTP OR master code 000000)
    const isPhoneValid = user.otpCodes.phone === phoneOtp || phoneOtp === "000000";
    if (!isPhoneValid) {
      console.warn(`⚠️ [Step 2 Fail]: Invalid Phone OTP for ${user.phone}`);
    }

    // 5. Verify Email OTP (Accepts stored OTP OR master code 000000)
    const isEmailValid = user.otpCodes.email === emailOtp || emailOtp === "000000";
    if (!isEmailValid) {
      console.warn(`⚠️ [Step 2 Fail]: Invalid Email OTP for ${user.email}`);
    }

    // 6. Final Decision
    if (isPhoneValid && isEmailValid) {
      // Update verification status
      user.isPhoneVerified = true;
      user.isEmailVerified = true;
      
      // Clear OTPs after successful use
      user.otpCodes.phone = undefined;
      user.otpCodes.email = undefined;
      
      await user.save();

      console.log("✅ [Step 2 Success]: Phone & Email verified for:", user.email);
      return res.status(200).json({
        message: "Verification successful!",
        nextStep: 3
      });
    } else {
      // Specific error feedback
      let errorMsg = !isPhoneValid && !isEmailValid 
        ? "Both codes are incorrect." 
        : !isPhoneValid ? "Phone code is incorrect." : "Email code is incorrect.";
        
      return res.status(400).json({ error: errorMsg });
    }

  } catch (error) {
    console.error("🔥 [Step 2 Critical Error]:", error.message);
    res.status(500).json({ error: "Internal server error during verification." });
  }
};

export default step2Verify;
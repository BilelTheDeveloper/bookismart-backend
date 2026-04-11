import User from '../../models/User.js';

const step4KYC = async (req, res) => {
  try {
    const { userId } = req.body;

    console.log(`🚀 [Step 4]: Processing Identity Verification for User ID: ${userId}`);

    // 1. Basic Validation
    if (!userId) {
      console.error("❌ [Step 4 Error]: No userId provided");
      return res.status(400).json({ error: "Session expired. Please restart." });
    }

    // 2. Check if all files are present
    // When using .fields() in multer, files are inside req.files as arrays
    if (!req.files || !req.files.idFront || !req.files.idBack || !req.files.livePhoto) {
      console.error("❌ [Step 4 Error]: Missing identity documents in request");
      return res.status(400).json({ 
        error: "Please provide CIN (Front & Back) and the Live Photo capture." 
      });
    }

    // 3. Find the User
    const user = await User.findById(userId);
    if (!user) {
      console.error("❌ [Step 4 Error]: User not found");
      return res.status(404).json({ error: "Account not found." });
    }

    // 4. Extract Cloudinary URLs
    // The middleware has already uploaded these to Cloudinary
    const idFrontUrl = req.files.idFront[0].path;
    const idBackUrl = req.files.idBack[0].path;
    const livePhotoUrl = req.files.livePhoto[0].path;

    // 5. Update KYC and Account Status
    user.kyc.idFrontUrl = idFrontUrl;
    user.kyc.idBackUrl = idBackUrl;
    user.kyc.livePhotoUrl = livePhotoUrl;
    user.kyc.status = 'pending';
    
    // We keep the user in 'on_boarding' until they click 'Submit' in Step 5
    await user.save();

    console.log("✅ [Step 4 Success]: KYC documents saved for user:", user.email);
    console.log("🔗 Links saved:", { idFrontUrl, idBackUrl, livePhotoUrl });

    res.status(200).json({
      message: "Identity documents uploaded successfully.",
      nextStep: 5
    });

  } catch (error) {
    console.error("🔥 [Step 4 Critical Error]:", error.message);
    res.status(500).json({ error: "Internal server error during identity upload." });
  }
};

export default step4KYC;
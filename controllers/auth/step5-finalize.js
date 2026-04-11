import User from '../../models/User.js';

const step5Finalize = async (req, res) => {
  try {
    const { userId, agreedToTerms } = req.body;

    console.log(`🚀 [Step 5]: Finalizing Application for User ID: ${userId}`);

    // 1. Validation
    if (!userId) {
      console.error("❌ [Step 5 Error]: No userId provided");
      return res.status(400).json({ error: "Session expired." });
    }

    if (!agreedToTerms) {
      console.warn("⚠️ [Step 5 Fail]: User did not agree to terms");
      return res.status(400).json({ error: "You must agree to the Terms of Service to continue." });
    }

    // 2. Find and Finalize the User
    const user = await User.findById(userId);
    if (!user) {
      console.error("❌ [Step 5 Error]: User not found");
      return res.status(404).json({ error: "Account not found." });
    }

    // 3. Set Subscription & Status Logic
    // We set the status to 'review' so they can't access the dashboard 
    // until an admin checks their Step 4 CIN photos.
    user.accountStatus = 'review';
    
    // Set Trial Dates (90 Days from today)
    const trialEnd = new Date();
    trialEnd.setDate(trialEnd.getDate() + 90);
    
    user.paymentInfo.subscription.plan = 'free_trial';
    user.paymentInfo.subscription.status = 'trialing';
    user.paymentInfo.subscription.trialEndsAt = trialEnd;

    await user.save();

    console.log("✅ [Step 5 SUCCESS]: Application Submitted for:", user.businessName);

    // 4. Send the Final Response
    res.status(200).json({
      success: true,
      message: "Application submitted! Our team will review your documents within 24 hours.",
      businessName: user.businessName,
      trialEndsAt: trialEnd
    });

  } catch (error) {
    console.error("🔥 [Step 5 Critical Error]:", error.message);
    res.status(500).json({ error: "Failed to finalize registration." });
  }
};

export default step5Finalize;
import User from '../../models/User.js';

// The uploadCloudinary middleware handles the upload before this function starts
// and attaches the secure URL to req.file.path.

const step1Profile = async (req, res) => {
  try {
    const { fullName, email, phone, businessName, category, city } = req.body;

    console.log("🚀 [Step 1]: Processing registration for:", email);

    // 1. Validate Required Fields
    if (!fullName || !email || !phone || !businessName || !category || !city) {
      console.error("❌ [Step 1 Error]: Missing required fields in request body");
      return res.status(400).json({ error: "Please fill in all required fields." });
    }

    // 2. Check for existing User (Email or Phone)
    const existingUser = await User.findOne({ $or: [{ email }, { phone }] });
    if (existingUser) {
      console.warn("⚠️ [Step 1 Conflict]: Email or Phone already exists:", email, phone);
      return res.status(409).json({ 
        error: "An account with this email or phone number already exists." 
      });
    }

    // 3. Handle Profile Picture (Cloudinary Integration)
    let profilePicUrl = "";
    if (req.file) {
      // With multer-storage-cloudinary, path is the secure Cloudinary URL
      profilePicUrl = req.file.path; 
      console.log("📸 [Step 1]: Profile picture saved to Cloudinary:", profilePicUrl);
    }

    // 4. Create the User Document (Initial State)
    // We set a temporary password or leave it empty if your model allows
    // Usually, we create the user here and they set the password in Step 3
    const newUser = new User({
      fullName,
      email,
      phone,
      businessName,
      category,
      ville: city, // Mapping frontend 'city' to model 'ville'
      profilePicUrl,
      password: "TEMP_PASSWORD_STEP_1", // Will be updated in Step 3
      accountStatus: 'on_boarding'
    });

    const savedUser = await newUser.save();

    console.log("✅ [Step 1 Success]: User created with ID:", savedUser._id);

    // 5. Return the User ID so the frontend can use it for Step 2, 3, and 4
    res.status(201).json({
      message: "Step 1 complete: Profile created.",
      userId: savedUser._id,
      nextStep: 2
    });

  } catch (error) {
    console.error("🔥 [Step 1 Critical Error]:", error.message);
    res.status(500).json({ error: "Internal server error during Step 1." });
  }
};

export default step1Profile;
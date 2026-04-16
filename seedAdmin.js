import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";

// Import your Admin model - adjust the path if necessary
// import Admin from "./models/Admin.js"; 

dotenv.config();

// Define the Schema locally in case the import fails
const adminSchema = new mongoose.Schema({
  fullName: String,
  email: String,
  password: String,
  accessLevel: String,
  isActive: Boolean,
  secretKey: String,
}, { timestamps: true });

const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);

const seedAdmin = async () => {
  try {
    await mongoose.connect(process.env.MONGO_URI);
    console.log("📡 Connected to MongoDB...");

    const email = "bilel.thedeveloper@gmail.com";
    
    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email });
    if (existingAdmin) {
      console.log("⚠️ Admin already exists. Deleting old record to update...");
      await Admin.deleteOne({ email });
    }

    // Hash the long password
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash("13Bilelukga!:é&'diudgaudgaiudjamila(\"ygvildyailzdyvgazild", salt);

    const superAdmin = new Admin({
      fullName: "Bilel Helal",
      email: email,
      password: hashedPassword,
      accessLevel: "admin",
      isActive: true,
      secretKey: "13Bilelukga!:é&'diudgaudgaiudjamila(\"ygvildyailzdyvgazild"
    });

    await superAdmin.save();
    console.log("✅ Super Admin created successfully!");
    process.exit();
  } catch (error) {
    console.error("❌ Error seeding admin:", error);
    process.exit(1);
  }
};

seedAdmin();
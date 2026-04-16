import jwt from "jsonwebtoken";
import Admin from "../models/Access.js"; // Adjust path to your Admin model

const protectAdmin = async (req, res, next) => {
  let token;

  if (req.headers.authorization && req.headers.authorization.startsWith("Bearer")) {
    try {
      // 1. Get token from header
      token = req.headers.authorization.split(" ")[1];

      // 2. Verify token
      const decoded = jwt.verify(token, process.env.JWT_SECRET);

      // 3. Find the user in the ADMIN collection specifically
      req.user = await Admin.findById(decoded.id).select("-password");

      if (!req.user) {
        return res.status(401).json({ error: "Not authorized, admin account not found." });
      }

      next();
    } catch (error) {
      console.error("Admin Auth Error:", error);
      res.status(401).json({ error: "Not authorized, token failed" });
    }
  }

  if (!token) {
    res.status(401).json({ error: "Not authorized, no token" });
  }
};

export { protectAdmin };
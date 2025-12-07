const mongoose = require("mongoose");

const userSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  hashedPassword: { type: String, required: true },
  isVerified: { type: Boolean, default: false },
  storageUsed: { type: Number, default: 0 }, // bytes
  storageLimit: { type: Number, default: 100 * 1024 * 1024 }, // 100 MB in bytes
}, { timestamps: true });

module.exports = mongoose.model("User", userSchema);

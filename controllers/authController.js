require("dotenv").config(); 

const { hashToken } = require("../utils/hashTokens");
const { Resend } = require('resend');

const RefreshToken = require("../models/RefreshToken");
const User = require("../models/User");
const EmailVerificationToken = require('../models/EmailVerificationToken');

const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const crypto = require("crypto");

// load env variables
const MONGODB_URI = process.env.MONGODB_URI;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TOKEN_EXPIRY = process.env.ACCESS_TOKEN_EXPIRY || "15m";
const REFRESH_TOKEN_EXPIRY_MS = parseInt(process.env.REFRESH_TOKEN_EXPIRY_MS) || 7 * 24 * 60 * 60 * 1000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;


// connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});


//register
exports.register = async (req, res) => {
  console.log("Register request body:", req.body);
  const { email, password, name } = req.body;

  if (!email || !password || !name) return res.status(400).json({ message: 'Missing fields' });

  const existingUser = await User.findOne({ email: email.trim() });
  if (existingUser) return res.status(409).json({ message: 'A user with that email already exists' });

  const hashedPassword = await bcrypt.hash(password, 10);

  const newUser = new User({ email, name, hashedPassword, isVerified: false });
  await newUser.save();


  const token = crypto.randomBytes(32).toString("hex");
  const hashedToken = await bcrypt.hash(token, 10);

  await EmailVerificationToken.create({
    userId: newUser._id,
    token: hashedToken,
    expiresAt: Date.now() + 24 * 60 * 60 * 1000 // 24 hrs
  });

  const verificationLink = `${process.env.SERVER_URL}/api/auth/verify-email?token=${token}`;

  const resend = new Resend(RESEND_API_KEY);

  resend.emails.send({
  from: 'CodeKeeper <onboarding@resend.dev>',
  to: newUser.email,
  subject: 'Verify Your Email',
   html: `
    <h2>Email Verification</h2>
    <p>Hi ${newUser.name},</p>
    <p>Click the link below to verify your account:</p>
    <a href="${verificationLink}">Verify Email</a>
    <p>This link is valid for 24 hours.</p>
  `
});

  // Generate tokens
  // const accessToken = jwt.sign({ userId: newUser._id }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
  // const refreshToken = jwt.sign({ userId: newUser._id }, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_MS}ms` });

  // // Save hashed refresh token
  // const hashed = hashToken(refreshToken);
  // const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);
  // await new RefreshToken({ userId: newUser._id, hashedToken: hashed, expiresAt }).save();

  // Return tokens
  return res.status(201).json({
    message: "Registration successful! Verification email sent.",
    user: {
      id: newUser._id,
      name: newUser.name,
      email: newUser.email,
      isVerified: false
    }
  });
};


exports.verifyEmail = async (req, res) => {
  const { token } = req.query;

  if (!token) return res.status(400).send("Missing token");

  const records = await EmailVerificationToken.find();

  let validRecord = null;
  for (const record of records) {
    const isMatch = await bcrypt.compare(token, record.token);
    if (isMatch) {
      validRecord = record;
      break;
    }
  }

  if (!validRecord) return res.status(400).send("Invalid or expired token");

  if (validRecord.expiresAt < Date.now())
    return res.status(400).send("Token expired");

  await User.findByIdAndUpdate(validRecord.userId, { isVerified: true });
  await EmailVerificationToken.deleteOne({ _id: validRecord._id });

  return res.send("Email verified successfully!");
};


exports.login = async (req, res) => {
  console.log("Login request body:", req.body);
  const { email, password } = req.body;
  
  try {
    const user = await User.findOne({ email });
    if (!user) return res.status(401).json({ message:"Invalid credentials."});

    if (!user.isVerified) {
      return res.status(403).json({
        message: "Email not verified",
        needVerification: true
      });
    }

    const isMatch = await bcrypt.compare(password, user.hashedPassword);
    if (!isMatch) return res.status(401).json({ message:"Invalid credentials."});

    const accessToken = jwt.sign({ userId: user._id }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const refreshToken = jwt.sign({ userId: user._id }, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_MS}ms` });

    const hashed = hashToken(refreshToken);
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS);

    await new RefreshToken({ userId: user._id, hashedToken: hashed, expiresAt }).save();

    // Return user data along with tokens
    res.json({ 
      accessToken, 
      refreshToken,
      user: {
        id: user._id,
        name: user.name,
        email: user.email
        // Add any other user fields you want to send to frontend
      }
    });
    
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Server error" });
  }
};

//refresh token
exports.refresh = async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).send("Refresh token required");

  try {
    const payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    const userId = payload.userId;

    const hashed = hashToken(refreshToken);
    const storedToken = await RefreshToken.findOne({ userId, hashedToken: hashed });
    if (!storedToken) return res.status(401).send("Refresh token not recognized.");
    if (storedToken.expiresAt < new Date()) return res.status(401).send("Refresh token has expired.");

    await storedToken.deleteOne();

    const newAccessToken = jwt.sign({ userId }, JWT_SECRET, { expiresIn: ACCESS_TOKEN_EXPIRY });
    const newRefreshToken = jwt.sign({ userId }, JWT_REFRESH_SECRET, { expiresIn: `${REFRESH_TOKEN_EXPIRY_MS}ms` });

    await new RefreshToken({
      userId,
      hashedToken: hashToken(newRefreshToken),
      expiresAt: new Date(Date.now() + REFRESH_TOKEN_EXPIRY_MS)
    }).save();

    res.json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (err) {
    return res.status(401).send("Invalid refresh token.");
  }
};

// logout
exports.logout = async (req, res) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(400).send("Refresh token required.");

    // Verify token validity
    let payload;
    try {
      payload = jwt.verify(refreshToken, JWT_REFRESH_SECRET);
    } catch (err) {
      return res.status(401).send("Invalid refresh token.");
    }

    const userId = payload.userId;
    const hashed = hashToken(refreshToken);

    // Delete the matching token from DB
    const deleted = await RefreshToken.findOneAndDelete({ userId, hashedToken: hashed });

    if (!deleted) {
      // Token not found in DB → possibly already invalidated
      return res.status(200).json({ message: "Already logged out or token not found." });
    }

    return res.status(200).json({ message: "Logout successful." });
  } catch (err) {
    console.error("Logout error:", err);
    res.status(500).send("Server error during logout.");
  }
};

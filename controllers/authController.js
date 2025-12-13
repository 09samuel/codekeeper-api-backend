require("dotenv").config(); 

const { hashToken } = require("../utils/hashTokens");
const brevo = require('@getbrevo/brevo');

const RefreshToken = require("../models/RefreshToken");
const User = require("../models/User");
const EmailVerificationToken = require('../models/EmailVerificationToken');
const PasswordResetToken = require('../models/PasswordResetToken');

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
const BREVO_API_KEY = process.env.BREVO_API_KEY;



// connect to MongoDB
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});


//register
exports.register = async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const { email, password, name } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const existingUser = await User.findOne({ email: email.trim() }).session(session);
    if (existingUser) {
      await session.abortTransaction();
      return res.status(409).json({ error: 'A user with that email already exists' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = new User({ 
      email, 
      name, 
      hashedPassword, 
      isVerified: false 
    });
    await newUser.save({ session });

    // Generate token
    const token = crypto.randomBytes(32).toString("hex");
    const hashedToken = await bcrypt.hash(token, 10);

    await EmailVerificationToken.create([{
      userId: newUser._id,
      token: hashedToken,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000
    }], { session });

    // Send email
    const verificationLink = `${process.env.SERVER_URL}/api/auth/verify-email?token=${token}`;
    
    let apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, BREVO_API_KEY);

    let sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: 'CodeKeeper', email: 'samuelfernandes009@gmail.com' };
    sendSmtpEmail.to = [{ email: newUser.email, name: newUser.name }];
    sendSmtpEmail.subject = 'Verify Your Email';
    sendSmtpEmail.htmlContent = `
      <h2>Email Verification</h2>
      <p>Hi ${newUser.name},</p>
      <p>Click the link below to verify your account:</p>
      <a href="${verificationLink}">Verify Email</a>
      <p>This link is valid for 24 hours.</p>
    `;

    try {
      await apiInstance.sendTransacEmail(sendSmtpEmail);
    } catch (emailError) {
      console.error('Email sending failed:', emailError);
      await session.abortTransaction();
      return res.status(500).json({ 
        error: 'Failed to send verification email. Please try again later.',
        details: emailError.message 
      });
    }

    // Commit transaction only if everything succeeded
    await session.commitTransaction();

    return res.status(201).json({
      message: "Registration successful! Verification email sent.",
      user: {
        id: newUser._id,
        name: newUser.name,
        email: newUser.email,
        isVerified: false
      }
    });

  } catch (error) {
    await session.abortTransaction();
    console.error('Registration error:', error);
    return res.status(500).json({ 
      error: 'Registration failed',
      details: error.message 
    });
  } finally {
    session.endSession();
  }
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



// Forgot Password - Request reset link
exports.forgotPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    const user = await User.findOne({ email: email.trim() });
    
    // For security, don't reveal if email exists
    if (!user) {
      return res.status(200).json({ 
        message: 'If that email exists, a password reset link has been sent.' 
      });
    }

    // Delete any existing reset tokens for this user
    await PasswordResetToken.deleteMany({ userId: user._id });

    // Generate secure random token
    const resetToken = crypto.randomBytes(32).toString("hex");
    const hashedToken = await bcrypt.hash(resetToken, 10);

    // Save token with 1 hour expiry
    await PasswordResetToken.create({
      userId: user._id,
      token: hashedToken,
      expiresAt: Date.now() + 60 * 60 * 1000 // 1 hour
    });

    // Send reset email via Brevo
    const resetLink = `${process.env.CLIENT_URL}/reset-password?token=${resetToken}`;
    
    let apiInstance = new brevo.TransactionalEmailsApi();
    apiInstance.setApiKey(brevo.TransactionalEmailsApiApiKeys.apiKey, BREVO_API_KEY);

    let sendSmtpEmail = new brevo.SendSmtpEmail();
    sendSmtpEmail.sender = { name: 'CodeKeeper', email: 'samuelfernandes009@gmail.com' };
    sendSmtpEmail.to = [{ email: user.email, name: user.name }];
    sendSmtpEmail.subject = 'Reset Your Password';
    sendSmtpEmail.htmlContent = `
      <h2>Password Reset Request</h2>
      <p>Hi ${user.name},</p>
      <p>You requested to reset your password. Click the link below to proceed:</p>
      <a href="${resetLink}">Reset Password</a>
      <p>This link is valid for 1 hour.</p>
      <p>If you didn't request this, please ignore this email.</p>
    `;

    try {
      await apiInstance.sendTransacEmail(sendSmtpEmail);
    } catch (emailError) {
      console.error('Password reset email failed:', emailError);
      await PasswordResetToken.deleteOne({ userId: user._id });
      return res.status(500).json({ 
        error: 'Failed to send reset email. Please try again later.' 
      });
    }

    return res.status(200).json({
      message: 'If that email exists, a password reset link has been sent.'
    });

  } catch (error) {
    console.error('Forgot password error:', error);
    return res.status(500).json({ 
      error: 'Server error. Please try again later.' 
    });
  }
};


exports.resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res.status(400).json({ error: 'Token and new password are required' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }

  try {
    // Find valid token by comparing hashed version
    const records = await PasswordResetToken.find();

    let validRecord = null;
    for (const record of records) {
      const isMatch = await bcrypt.compare(token, record.token);
      if (isMatch) {
        validRecord = record;
        break;
      }
    }

    if (!validRecord) {
      return res.status(400).json({ error: 'Invalid or expired reset token' });
    }

    if (validRecord.expiresAt < Date.now()) {
      await PasswordResetToken.deleteOne({ _id: validRecord._id });
      return res.status(400).json({ error: 'Reset token has expired' });
    }

    // Get user's current password
    const user = await User.findById(validRecord.userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if new password is same as old password
    const isSamePassword = await bcrypt.compare(newPassword, user.hashedPassword);
    if (isSamePassword) {
      return res.status(400).json({ 
        error: 'New password cannot be the same as your current password' 
      });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update user password
    await User.findByIdAndUpdate(validRecord.userId, { 
      hashedPassword 
    });

    // Delete used token (one-time use)
    await PasswordResetToken.deleteOne({ _id: validRecord._id });

    // Invalidate all refresh tokens for security
    await RefreshToken.deleteMany({ userId: validRecord.userId });

    return res.status(200).json({ 
      message: 'Password reset successful. Please log in with your new password.' 
    });

  } catch (error) {
    console.error('Reset password error:', error);
    return res.status(500).json({ 
      error: 'Failed to reset password. Please try again.' 
    });
  }
};

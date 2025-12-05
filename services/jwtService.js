const jwt = require("jsonwebtoken");
const JWT_SECRET = process.env.JWT_SECRET;

exports.generateToken = (userId, expiry) => {
  return jwt.sign({ userId }, JWT_SECRET, { expiresIn: expiry });
};

exports.verifyToken = (token) => {
  return jwt.verify(token, JWT_SECRET);
};
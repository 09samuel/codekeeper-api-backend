const crypto = require('crypto');

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("base64");
}

module.exports = {
  hashToken
};
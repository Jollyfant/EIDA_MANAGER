const crypto = require("crypto");

function SHA256(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

module.exports = SHA256;

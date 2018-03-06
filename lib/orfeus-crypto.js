const crypto = require("crypto");

function SHA256(buffer) {

  /* function SHA256
   * Returns SHA256 hash of a buffer
   */

  return crypto.createHash("sha256").update(buffer).digest("hex");

}

module.exports = SHA256;

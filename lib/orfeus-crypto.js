/* lib/orfeus-crypto.js
 * 
 * Wrapper for crypto functions
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2017
 *
 */

const crypto = require("crypto");

function SHA256(buffer) {

  /* function SHA256
   * Returns the SHA256 hash of a buffer
   */

  return crypto.createHash("sha256").update(buffer).digest("hex");

}

module.exports = SHA256;

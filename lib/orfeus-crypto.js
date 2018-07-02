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

function randomId(entropy) {

  /* function randomId
   * Returns a random identifier of N bytes of entropy
   */

  return crypto.randomBytes(entropy).toString("hex");

}

module.exports.SHA256 = SHA256;
module.exports.randomId = randomId;

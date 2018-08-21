/*
 * lib/orfeus-crypto.js
 * 
 * Wrapper for crypto functions
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const crypto = require("crypto");

function SHAXOR(hashes) {

  /*
   * Function SHAXOR
   * Returns the XOR of multiple SHA256 hashes
   * We do this so that the order of hashes does not matter
   */

  if(hashes.length === 0) {
    return null;
  }

  var buffer = hashes.pop();

  // XOR the other hashes
  hashes.forEach(function(hash) {

    // Bitwise XOR per byte
    for(var j = 0; j < buffer.length; j++) {
      buffer[j] = buffer[j] ^ hash[j];
    }

  });

  // Return the XOR SHA256 in hex representation
  return buffer.toString("hex");

}

function SHA256Raw(buffer) {

  /*
   * Function SHA256Raw
   * Returns the raw SHA256 hash of a buffer
   */

  return crypto.createHash("sha256").update(buffer).digest();

}

function SHA256(buffer) {

  /*
   * Function SHA256
   * Returns the SHA256 hash of a buffer
   */

  return crypto.createHash("sha256").update(buffer).digest("hex");

}

function randomId(entropy) {

  /*
   * Function randomId
   * Returns a random identifier of N bytes of entropy
   */

  return crypto.randomBytes(entropy).toString("hex");

}

module.exports = {
  SHA256,
  SHA256Raw,
  randomId,
  SHAXOR
}

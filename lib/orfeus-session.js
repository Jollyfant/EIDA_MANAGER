const { randomBytes } = require("crypto");
const CONFIG = require("../config");

var Session = function(user) {

  /* Class Session
   * Returns a new authenticated session
   */

  const BYTES_ENTROPY = 32;

  // Create a new session ID
  this.id = randomBytes(BYTES_ENTROPY).toString("hex");
  this.expiration = new Date(new Date().getTime() + CONFIG.SESSION.TIMEOUT);

}

module.exports = Session;

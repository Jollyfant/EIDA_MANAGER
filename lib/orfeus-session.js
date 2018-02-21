const crypto = require("crypto");

var Session = function(user) {

  /* Class Session
   * Returns a new authenticated session
   */

  const SESSION_TIMEOUT = 3600 * 1000;

  // Create a new session ID
  this.id = crypto.randomBytes(32).toString("hex");
  this.expiration = new Date(new Date().getTime() + SESSION_TIMEOUT);

}

module.exports = Session;

const { randomId } = require("./lib/orfeus-crypto");
const CONFIG = require("./config");

var Session = function(user) {

  /* Class Session
   * Returns a new authenticated session
   */

  const BYTES_ENTROPY = 32;

  // Create a new session ID
  this.id = randomId(BYTES_ENTROPY);
  this.expiration = new Date(new Date().getTime() + CONFIG.SESSION.TIMEOUT);

}

var User = function(user, id) {

  /* Class User
   * Holds user information
   */

  this._id = user._id;
  this.sessionId = id;
  this.username = user.username;

  if(user.role === "admin") {
    this.network = "*";
  } else {
    this.network = user.network;
  }

  this.version = user.version;
  this.visited = user.visited;
  this.role = user.role;

}

module.exports.Session = Session;
module.exports.User = User;

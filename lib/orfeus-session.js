/*
 * EIDA Manager - lib/orfeus-session.js
 * 
 * Wrapper for application User & Session classes
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const { randomId } = require("./lib/orfeus-crypto");
const CONFIG = require("./config");

var Session = function() {

  /*
   * Class Session
   * Returns a new authenticated session
   */

  const BYTES_ENTROPY = 32;

  // Create a new session ID
  this.id = randomId(BYTES_ENTROPY);
  this.expiration = new Date(new Date().getTime() + CONFIG.SESSION.TIMEOUT);

}

var User = function(user, id, prototype) {

  /*
   * Class User
   * Holds user information
   */

  this._id = user._id;
  this.sessionId = id;
  this.username = user.username;
  this.version = user.version;
  this.visited = user.visited;
  this.role = user.role;

  // Administrators can use wildcards for networks
  // Otherwise a network is identifier by a start time and network code
  this.prototype = prototype || {"network": {"code": "*", "start": null}};

}

module.exports = {
  Session,
  User
}

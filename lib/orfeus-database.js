/* lib/orfeus-database.js
 * 
 * Wrapper for MongoDB connection 
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const MongoClient = require("mongodb");
const Console = require("./lib/orfeus-logging");
const CONFIG = require("./config");

var Database = function() {

  /* Class Database
   * Returns a MongoDB instance
   */

  this.SESSION_COLLECTION = "sessions";
  this.MESSAGE_COLLECTION = "messages";
  this.USER_COLLECTION = "users";
  this.SEEDLINK_COLLECTION = "seedlink";
  this.FILE_COLLECTION = "files";

  // Metadata status codes
  this.METADATA_STATUS_SUPERSEDED = -3;
  this.METADATA_STATUS_DELETED = -2;
  this.METADATA_STATUS_REJECTED = -1;
  this.METADATA_STATUS_UNCHANGED = 0;
  this.METADATA_STATUS_PENDING = 1;
  this.METADATA_STATUS_VALIDATED = 2;
  this.METADATA_STATUS_CONVERTED = 3;
  this.METADATA_STATUS_ACCEPTED = 4;
  this.METADATA_STATUS_COMPLETED = 5;

  this.E_CONNECTION_ERROR = new Error("Could not connect to the database");

  this.DESCENDING = -1;
  this.ASCENDING = 1;

  // Variable for the database
  this._database = null;

}

Database.prototype.seedlink = function() {
  return this.connection().collection(this.SEEDLINK_COLLECTION);
}

Database.prototype.files = function() {
  return this.connection().collection(this.FILE_COLLECTION);
}

Database.prototype.users = function() {
  return this.connection().collection(this.USER_COLLECTION);
}

Database.prototype.messages = function() {
  return this.connection().collection(this.MESSAGE_COLLECTION);
}

Database.prototype.sessions = function() {
  return this.connection().collection(this.SESSION_COLLECTION);
}

Database.prototype.close = function() {

  /* Function Database.close
   * Closes the database connection
   */

  this._database.close();

}

Database.prototype.getConnectionString = function() {

  /* Function Database.getConnectionString
   * Returns the MongoDB connection string
   */

  return "mongodb://" + CONFIG.MONGO.HOST + ":" + CONFIG.MONGO.PORT + "/";

}

Database.prototype.connect = function(callback) {
 
  /* Function Database.connect
   * Connects to the Mongo database
   */

  var connectionString = this.getConnectionString();

  const mongoOptions = {
    "reconnectTries": 1E3,
    "useNewUrlParser": true
  }

  MongoClient.connect(connectionString, mongoOptions, function(error, database) {

    // Database is not running: propogate error
    if(error) {
      return callback(error);
    }

    // Expose
    this._database = database;

    Console.info("Database connected at " + connectionString);

    // When reconnecting
    database.on("reconnect", function() {
      Console.info("Database reconnected.");
    }.bind(this));

    // Database closed unexpectedly
    database.on("close", function() {
      Console.fatal("Database connection closed.");
    });

    // Callback without error
    callback(null);

  }.bind(this));

}

Database.prototype.connection = function() {

  /* Database.connection
   * Returns the database connection
   */

  return this._database.db(CONFIG.MONGO.NAME);

}

Database.prototype.ObjectId = function(id) {

  /* function Database.ObjectId
   * Returns MongoDB ObjectID type for hex string
   */

  try {
    return MongoClient.ObjectId(id);
  } catch(error) {
    return null;
  }

}

Database.prototype.getAdministrators = function(callback) {

  /* function Database.getAdministrators
   * Returns an array of administrators
   */

  this.users().find({"role": "admin"}).toArray(callback);

}

Database.prototype.storeMessages = function(messages, callback) {

  this.messages().insertMany(messages, callback);

}

Database.prototype.getSession = function(sessionIdentifier, callback) {

  this.sessions().findOne({"sessionId": sessionIdentifier}, callback);

}

Database.prototype.getUserById = function(userIdentifier, callback) {

  this.users().findOne({"_id": this.ObjectId(userIdentifier)}, callback);

}

Database.prototype.getUsersById = function(userIdentifiers, callback) {

  this.users().find({"_id": {"$in": userIdentifiers}}).toArray(callback);

}

Database.prototype.getUserByName = function(username, callback) {

  this.users().findOne({"username": username}, callback);

}

Database.prototype.getFileByHash = function(hash, callback) {

  this.files().findOne({"sha256": hash}, callback);

}

Database.prototype.getFileByStation = function(network, station, callback) {

  this.files().find({"network": network, "station": station}).toArray(callback);

}

Database.prototype.getNewMessageCount = function(id, callback) {

  this.messages().find({"recipient": this.ObjectId(id), "read": false, "recipientDeleted": false}).count(callback);

}

Database.prototype.getMessages = function(id, callback) {

  this.messages().find({"$or": [{"recipient": this.ObjectId(id), "recipientDeleted": false }, {"sender": this.ObjectId(id), "senderDeleted": false}]}).sort({"created": this.DESCENDING}).toArray(callback);


}

Database.prototype.getMessageById = function(id, messageId, callback) {

  this.messages().findOne({"_id": this.ObjectId(messageId), "$or": [{"recipient": this.ObjectId(id), "recipientDeleted": false}, {"sender": this.ObjectId(id), "senderDeleted": false}]}, callback);

}

module.exports = new Database();

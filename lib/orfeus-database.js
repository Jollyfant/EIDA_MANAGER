const MongoClient = require("mongodb");
const Console = require("./orfeus-logging");
const CONFIG = require("../config");

var Database = function() {

  /* Class Database
   * Returns a MongoDB instance
   */

  this.SESSION_COLLECTION = "sessions";
  this.MESSAGE_COLLECTION = "messages";
  this.USER_COLLECTION = "users";
  this.FILE_COLLECTION = "files";

  this._database = null;

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

Database.prototype.connect = function(callback) {
 
  /* function Database.connect
   * Connects to the Mongo Database
   */

  const __PROTOCOL__ = "mongodb://"
  const connectionString = __PROTOCOL__ + CONFIG.MONGO.HOST + ":" + CONFIG.MONGO.PORT + "/";

  const DATABASE_CLOSED = "Database connection closed";
  const DATABASE_RECONNECTED = "Database has been reconnected";

  MongoClient.connect(connectionString, function(error, database) {

    // Database is not running 
    if(error) {
      return callback(error);
    }

    Console.info("Database connected at " + connectionString);  

    // When reconnecting
    database.on("reconnect", function() {
      Console.info(DATABASE_RECONNECTED);
      this._database = database.db(CONFIG.MONGO.NAME);
    }.bind(this));

    // Database closed unexpectedly
    database.on("close", function() {
      Console.fatal(DATABASE_CLOSED);
      this._database = null;
    }.bind(this));

    this._database = database.db(CONFIG.MONGO.NAME);

    // Callback without error
    callback(null);

  }.bind(this));

}

Database.prototype.connection = function() {

  /* Database.connection
   * Returns the database connection
   */

  return this._database;

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

module.exports = new Database();
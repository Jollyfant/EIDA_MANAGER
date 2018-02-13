const MongoClient = require("mongodb");
const Console = require("./orfeus-logging");
const CONFIG = require("./config");

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

  MongoClient.connect(connectionString, function(error, database) {

    if(error) {
      return callback(error);
    }

    Console.info("Database connected at " + connectionString);  
    this._database = database.db("orfeus-manager");

    callback(null);

  }.bind(this));

}

Database.prototype.connection = function() {
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

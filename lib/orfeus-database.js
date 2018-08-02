/*
 * lib/orfeus-database.js
 * 
 * Wrapper for MongoDB connection 
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const fs = require("fs");
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
   * Returns an array of all administrators in the database
   */

  this.users().find({"role": "admin"}).toArray(callback);

}

Database.prototype.storeMessages = function(messages, callback) {

  /* Function Database.storeMessages
   * Stores an array of messages
   */

  this.messages().insertMany(messages, callback);

}

Database.prototype.getSession = function(sessionIdentifier, callback) {

  /* Function Database.getSession
   * Returns the session identified by the session identifier
   */

  this.sessions().findOne({"sessionId": sessionIdentifier}, callback);

}

Database.prototype.getUserById = function(userIdentifier, callback) {

  /* Function Database.getUserById
   * Returns a single user identified by its MongoDB ObjectId
   */

  this.users().findOne({"_id": this.ObjectId(userIdentifier)}, callback);

}

Database.prototype.getUsersById = function(userIdentifiers, callback) {

  /* Function Database.getUsersById
   * Returns an array of users identified by an array of MongoDB ObjectIds
   */

  this.users().find({"_id": {"$in": userIdentifiers}}).toArray(callback);

}

Database.prototype.getUserByName = function(username, callback) {

  /* Function Database.getUserByName
   * Returns the user identified by the username
   */

  this.users().findOne({"username": username}, callback);

}

Database.prototype.deleteFileDocumentById = function(id, callback) {

  /* function Database.deleteFileDocumentById
   * Returns the user identified by the username
   */

  this.files().updateOne({"_id": id}, {"$set": {"status": this.METADATA_STATUS_DELETED}}, function(error, result) {

    // Default database handler
    if(error) {
      return callback(error);
    }

    callback(null);

  }.bind(this));

}

Database.prototype.supersedeDocumentById = function(id, callback) {

  /* function Database.supersedeDocumentById
   * Supersedes a document by its identifier
   */

  this.files().updateOne({"_id": id}, {"$set": {"status": this.METADATA_STATUS_SUPERSEDED}}, function(error, result) {

    // Default database handler
    if(error) {
      return callback(error);
    }

    callback(null);

  });

}

Database.prototype.supersedeOrDelete = function(document, callback) {

  /* function Database.supersedeOrDelete
   * Removes or updates a superseded document
   * Only "available" metadata will be saved and superseded and the rest will be deleted
   */

  // These are the statuses that should NOT be saved
  // and can be removed if superseded
  switch(document.status) {
    case this.METADATA_STATUS_REJECTED:
    case this.METADATA_STATUS_PENDING:
    case this.METADATA_STATUS_VALIDATED:
    case this.METADATA_STATUS_CONVERTED:
    case this.METADATA_STATUS_ACCEPTED:
      return this.deleteFileDocumentById(document._id, callback);
    case this.METADATA_STATUS_COMPLETED:
      return this.supersedeDocumentById(document._id, callback);
    default:
      return callback(null);
  }

}

Database.prototype.supersedeFileByStation = function(id, metadata, callback) {

  /* function Database.supersedeFileByStation
   * Supersedes or deletes a station entry from the database and disk
   */

  const findQuery = {
    "network": metadata.network,
    "station": metadata.station,
    "status": {"$ne": this.METADATA_STATUS_SUPERSEDED},
    "_id": {"$ne": this.ObjectId(id)}
  }

  this.files().find(findQuery).sort({"created": this.DESCENDING}).limit(1).toArray(function(error, documents) {

    // Propagate the error
    if(error) {
      return callback(error);
    }

    // Nothing to do
    if(documents.length === 0) {
      return callback(null);
    }

    // Check whether we should delete or set the document to superseded
    this.supersedeOrDelete(documents.pop(), callback);

  }.bind(this));

}

Database.prototype.supersedeFileByHash = function(network, hash, callback) {

  /* Function Database.supersedeFileByHash
   * Supersedes a single metadata document by hash
   * the network session identifier is passed to check authorization
   */

  // Administrators may supersede everything
  if(network === "*") {
    network = new RegExp(/.*/);
  }

  this.files().find({"network": network, "sha256": hash}).sort({"created": this.DESCENDING}).limit(1).toArray(function(error, documents) {

    if(error) {
      return callback(error);
    }

    if(documents.length === 0) {
      return callback(null);
    }

    // Other subroutine can decide whether the document needs to be superseded or deleted
    this.supersedeOrDelete(documents.pop(), callback);

  }.bind(this));

}

Database.prototype.getFileByHash = function(hash, callback) {

  /* Function Database.getFileByHash
   * Returns the metadata identified by its SHA256 hash
   */

  this.files().findOne({"sha256": hash}, callback);

}

Database.prototype.getFilesByStation = function(network, station, callback) {

  /* Function Database.getFilesByStation
   * Returns the list of metadata files identified by its network, station code
   */

  this.files().find({"network": network, "station": station}).toArray(callback);

}

Database.prototype.getNewMessageCount = function(id, callback) {

  /* Function Database.getNewMessageCount
   * Returns the number of new (unread) messages
   */

  this.messages().find({"recipient": this.ObjectId(id), "read": false, "recipientDeleted": false}).count(callback);

}

Database.prototype.getMessages = function(id, callback) {

  /* Function Database.getMessages
   * Returns an array of messages (sent or received)
   */

  this.messages().find({"$or": [{"recipient": this.ObjectId(id), "recipientDeleted": false }, {"sender": this.ObjectId(id), "senderDeleted": false}]}).sort({"created": this.DESCENDING}).toArray(callback);

}

Database.prototype.getMessageById = function(id, messageId, callback) {

  /* Function Database.getMessageById
   * Returns a single message identified by its MongoDB ObjectId
   */

  this.messages().findOne({"_id": this.ObjectId(messageId), "$or": [{"recipient": this.ObjectId(id), "recipientDeleted": false}, {"sender": this.ObjectId(id), "senderDeleted": false}]}, callback);

}

Database.prototype.getAcceptedInventory = function(callback) {

  /* Database.getAcceptedInventory
   * Returns the list of accepted metadata from the database
   */

  // The pipeline for getting all metadata flagged as
  // accepted or completed
  const pipeline = [{
    "$group": {
      "_id": {
        "network": "$network",
        "station": "$station",
      },
      "id": {
        "$last": "$_id"
      },
      "created": {
        "$last": "$created"
      },
      "status": {
        "$last": "$status"
      },
      "filepath": {
        "$last": "$filepath"
      }
    }
  }, {
    "$match": {
        "status": {
          "$in": [
            this.METADATA_STATUS_ACCEPTED,
            this.METADATA_STATUS_COMPLETED
          ]
        }
      }
  }];

  this.files().aggregate(pipeline).toArray(callback);

}

module.exports = new Database();

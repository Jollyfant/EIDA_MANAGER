/*
 * lib/orfeus-database.js
 * 
 * Wrapper for MongoDB connection 
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

// Native libs
const fs = require("fs");

// Third-party libs
const MongoClient = require("mongodb");

// Custom libs & configuration
const logger = require("./lib/orfeus-logging");
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
  this.PROTOTYPE_COLLECTION = "prototypes";

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

  this.DESCENDING = -1;
  this.ASCENDING = 1;

  // Variable for the database
  this._database = null;

}

Database.prototype.prototypes = function() {
  return this.connection().collection(this.PROTOTYPE_COLLECTION);
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

    logger.info("Database connected at " + connectionString);

    // When reconnecting
    database.on("reconnect", function() {
      logger.info("Database reconnected.");
    }.bind(this));

    // Database closed unexpectedly
    database.on("close", function() {
      logger.fatal("Database connection closed.");
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

Database.prototype.updateDocumentStatus = function(id, status, callback) {

  /* function Database.updateDocumentStatus
   * Updates the status of a single metadata document
   */

  this.files().updateOne({"_id": id}, {"$set": {"status": status, "modified": new Date()}}, function(error, result) {

    // Default database handler
    if(error) {
      return callback(error);
    }

    callback(null);

  }.bind(this));

}

Database.prototype.supersedeOrDelete = function(document, callback) {

  /* function Database.supersedeOrDelete
   * Removes or updates a superseded document
   * Only "available" metadata will be saved and superseded and the rest will be deleted
   */

  var { status, _id } = document;

  // These are the statuses that should NOT be saved since they were never available
  // and can be removed safely if superseded
  switch(status) {
    case this.METADATA_STATUS_REJECTED:
    case this.METADATA_STATUS_PENDING:
    case this.METADATA_STATUS_VALIDATED:
    case this.METADATA_STATUS_CONVERTED:
    case this.METADATA_STATUS_ACCEPTED:
      return this.updateDocumentStatus(_id, this.METADATA_STATUS_DELETED, callback);
    case this.METADATA_STATUS_COMPLETED:
      return this.updateDocumentStatus(_id, this.METADATA_STATUS_SUPERSEDED, callback);
    default:
      return callback(null);
  }

}

Database.prototype.supersedeFileByStation = function(id, metadata, callback) {

  /* function Database.supersedeFileByStation
   * Supersedes or deletes a station entry from the database and disk
   */

  const findQuery = {
    "network.code": metadata.network.code,
    "network.start": metadata.network.start,
    "station": metadata.station,
    "status": {"$ne": this.METADATA_STATUS_SUPERSEDED},
    "_id": {"$ne": this.ObjectId(id)}
  }

  this.supersedeLatest(findQuery, callback);

}

Database.prototype.getPrototypes = function(callback) {

  this.prototypes().find().toArray(callback);

}

Database.prototype.addPrototype = function(prototype, callback) {

  /* Database.addPrototype
   * Adds a single network prototype to the database
   */

  this.prototypes().insertOne(prototype, callback);

}

Database.prototype.getActivePrototype = function(network, callback) {

  /* Database.getActivePrototypes
   * Returns the currently active prototype
   */

  this.prototypes().find({"network": network}).sort({"created": this.DESCENDING}).limit(1).toArray(callback);
    
}

Database.prototype.updateNetwork = function(network, callback) {

  /* Database.supersedeNetwork
   * Updates the network metadata for all stations belonging to a network
   */

  logger.info("Updated all metadata derived for network prototype " + network.code);

  // Match the network and group by
  const pipeline = [{
    "$match": {
      "network.code": network.code,
      "network.start": network.start,
      "status": {
        "$ne": this.METADATA_STATUS_SUPERSEDED
      }
    }
  }, {
    "$group": {
      "_id": {
        "network": "$network",
        "station": "$station",
      },
      "id": {
        "$last": "$_id"
      },
      "filepath": {
        "$last": "$filepath"
      },
      "created": {
        "$last": "$created"
      },
      "status": {
        "$last": "$status"
      }
    }
  }];

  // Get all latest stations/networks
  this.files().aggregate(pipeline).toArray(function(error, documents) {

    // Propogate error
    if(error) {
      return callback(error);
    }

    // Update previous documents
    logger.info("Updating " + documents.length + " metadata documents for network " + network.code);

    // We will need to resubmit all station metadata for this network since the
    // prototype has change (e.g. restrictedStatus changed)
    var files = new Array();
    var readCallback;

    // Asynchronous but concurrent
    (readCallback = function() {

      // Nore more documents to read from disk
      if(!documents.length) {
        return callback(null, files);
      }

      // Read the file from disk for resubmission after changing
      fs.readFile(documents.pop().filepath + ".stationXML", function(error, buffer) {

        if(error) {
          return callback(error);
        }

        // Save buffer from the file
        files.push(buffer);

        // Proceed with next file
        readCallback();

      });

    }.bind(this))();

  }.bind(this));

}

Database.prototype.supersedeLatest = function(findQuery, callback) {

  /* function Database.supersedeLatest
   * Supersedes the latest metadata in the stack
   */

  // Get the latest submission (order by created)
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

Database.prototype.supersedeFileByHash = function(session, hash, callback) {

  /* Function Database.supersedeFileByHash
   * Supersedes a single metadata document by hash
   * The network session identifier is passed to check authorization
   */

  function getQuery(session, hash) {

    /* Function Database.supersedeFileByHash::getQuery
     * Returns the query dependent on the role of the user
     */

    switch(session.role) {
      case "admin":
        return {"sha256": hash}
      default:
        return {"network.code": session.prototype.network.code, "network.start": session.prototype.network.start, "sha256": hash}
    }

  }

  this.supersedeLatest(getQuery(session, hash), callback);

}

Database.prototype.getFileByHash = function(hash, callback) {

  /* Function Database.getFileByHash
   * Returns the metadata identified by its SHA256 hash
   */

  this.files().findOne({"sha256": hash}, callback);

}

Database.prototype.getFilesByStation = function(session, queryString, callback) {

  /* Function Database.getFilesByStation
   * Returns the list of metadata files identified by its network, station code
   */

  function getQuery(session, queryString) {

    /* Function Database.getFilesByStation::getQuery
     * Returns the query based on the role of the user
     * Administrators have global access 
     */

    switch(session.role) {
      case "admin": 
        return {"station": queryString.station, "network.code": queryString.network}
      default:
        return {"station": queryString.station, "network.code": session.prototype.network.code, "network.start": session.prototype.network.start}
    }

  }

  var findQuery = getQuery(session, queryString);

  this.files().find(findQuery).toArray(callback);

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

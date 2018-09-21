/*
 * lib/orfeus-database.js
 * 
 * Wrapper for MongoDB connection used in the EIDA Manager application
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

// Native libs
const fs = require("fs");
const path = require("path");

// Third-party libs
const MongoClient = require("mongodb");

// Custom libs & configuration
const logger = require("./lib/orfeus-logging");
const { createDirectory } = require("./lib/orfeus-util");
const { SHA256, randomId } = require("./lib/orfeus-crypto");
const { User, Session } = require("./lib/orfeus-session");
const { Message, escapeHTML } = require("./lib/orfeus-message");
const seisComP3 = require("./lib/orfeus-seiscomp");
const CONFIG = require("./config");

var Database = function() {

  /*
   * Class Database
   * Returns a MongoDB instance
   */

  // Collection names
  this.SESSION_COLLECTION = "sessions";
  this.MESSAGE_COLLECTION = "messages";
  this.USER_COLLECTION = "users";
  this.SEEDLINK_COLLECTION = "seedlink";
  this.FILE_COLLECTION = "files";
  this.PROTOTYPE_COLLECTION = "prototypes";

  // Metadata processing status codes
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

  this.ROLES = {
    "ADMINISTRATOR": 0,
    "USER": 1
  }

  // Variable for the database
  this._database = null;

}

Database.prototype.collection = function(collection) {

  /*
   * Function Database.collection
   * Returns a connection to an arbitrary MongoDB collection 
   */

  return this._database.db(CONFIG.MONGO.NAME).collection(collection);

}

Database.prototype.prototypes = function() {

  /*
   * Function Database.prototypes
   * Returns a reference to the network prototypes collection
   */

  return this.collection(this.PROTOTYPE_COLLECTION);

}

Database.prototype.seedlink = function() {

  /*
   * Function Database.seedlink
   * Returns a reference to the seedlink collection
   */

  return this.collection(this.SEEDLINK_COLLECTION);

}

Database.prototype.files = function() {

  /*
   * Function Database.files
   * Returns a reference to the files collection
   */

  return this.collection(this.FILE_COLLECTION);

}

Database.prototype.users = function() {

  /*
   * Function Database.users
   * Returns a reference to the users collection
   */

  return this.collection(this.USER_COLLECTION);

}

Database.prototype.messages = function() {

  /*
   * Function Database.messages
   * Returns a reference to the messages collection
   */

  return this.collection(this.MESSAGE_COLLECTION);

}

Database.prototype.sessions = function() {

  /*
   * Function Database.sessions
   * Returns a reference to the session collection
   */

  return this.collection(this.SESSION_COLLECTION);

}

Database.prototype.close = function() {

  /*
   * Function Database.close
   * Closes the database connection
   */

  this._database.close();

}

Database.prototype.getConnectionString = function(MONGO) {

  /*
   * Function Database.getConnectionString
   * Returns the MongoDB connection string
   */

  const authenticationMechanism = "SCRAM-SHA-1";
  const authenticationSource = "admin";

  return [
    "mongodb://",
    MONGO.USER + ":" + MONGO.PASS,
    "@",
    MONGO.HOST + ":" + MONGO.PORT,
    "?authMechanism=" + authenticationMechanism + "&authSource=" + authenticationSource
  ].join("");

}

Database.prototype.connect = function(callback) {
 
  /*
   * Function Database.connect
   * Connects to the Mongo database
   */

  var connectionString = this.getConnectionString(CONFIG.MONGO);

  const DB_OPTIONS = {
    "reconnectTries": 1E3,
    "useNewUrlParser": true
  }

  MongoClient.connect(connectionString, DB_OPTIONS, function(error, database) {

    // Database is not running: propogate error
    if(error) {
      return callback(error);
    }

    // Expose the database
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

    // Fire the callback without error
    callback(null);

  }.bind(this));

}

Database.prototype.ObjectId = function(id) {

  /*
   * Function Database.ObjectId
   * Returns MongoDB ObjectID type for hex string
   */

  try {
    return MongoClient.ObjectId(id);
  } catch(error) {
    return null;
  }

}

Database.prototype.getAdministrators = function(callback) {

  /*
   * Function Database.getAdministrators
   * Returns an array of all administrators in the database
   */

  this.users().find({"role": this.ROLES.ADMINISTRATOR}).toArray(callback);

}

Database.prototype.storeMessages = function(messages, callback) {

  /*
   * Function Database.storeMessages
   * Stores an array of messages
   */

  this.messages().insertMany(messages, callback);

}

Database.prototype.getSession = function(sessionIdentifier, callback) {

  /*
   * Function Database.getSession
   * Returns the session identified by the session identifier
   */

  this.sessions().findOne({"sessionId": sessionIdentifier}, callback);

}

Database.prototype.getUserById = function(userIdentifier, callback) {

  /*
   * Function Database.getUserById
   * Returns a single user identified by its MongoDB ObjectId
   */

  this.users().findOne({"_id": this.ObjectId(userIdentifier)}, callback);

}

Database.prototype.getAllUsers = function(callback) {

  /*
   * Function Database.getAllUsers
   * Returns data on all the users in the database
   */

  var include = {
    "username": true,
    "network": true,
    "created": true,
    "role": true
  }

  this.users().find().project(include).toArray(callback);

}

Database.prototype.getUsersById = function(userIdentifiers, callback) {

  /*
   * Function Database.getUsersById
   * Returns an array of users identified by an array of MongoDB ObjectIds
   */

  this.users().find({"_id": {"$in": userIdentifiers}}).toArray(callback);

}

Database.prototype.getUserByName = function(username, callback) {

  /*
   * Function Database.getUserByName
   * Returns the user identified by the username
   */

  this.users().findOne({"username": username}, callback);

}

Database.prototype.updateDocumentStatus = function(id, status, callback) {

  /*
   * Function Database.updateDocumentStatus
   * Updates the status of a single metadata document
   */

  var setStatus = {
    "$set": {
      "status": status,
      "modified": new Date()
    }
  }

  this.files().updateOne({"_id": id}, setStatus, function(error, result) {

    if(error) {
      return callback(error);
    }

    callback(null);

  });

}

Database.prototype.supersedeOrDelete = function(document, callback) {

  /*
   * Function Database.supersedeOrDelete
   * Removes or updates a superseded document
   * Only "available" metadata will be saved and superseded and the rest will be deleted
   */

  var { status, _id } = document;

  // These are the statuses that should NOT be saved since they were never available
  // and can be removed safely if superseded by a more recent document
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

  /*
   * Function Database.supersedeFileByStation
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

  /*
   * Function Database.getPrototypes
   * Returns a list of network prototypes from the database
   */

  this.prototypes().find().toArray(callback);

}

Database.prototype.addPrototype = function(prototype, callback) {

  /*
   * Function Database.addPrototype
   * Adds a single network prototype to the database
   */

  this.prototypes().insertOne(prototype, callback);

}

Database.prototype.getActivePrototype = function(network, callback) {

  /*
   * Function Database.getActivePrototype
   * Returns the currently active prototype
   */

  if(network === undefined) {
    return callback(null);
  }

  this.prototypes().find({"network.code": network.code, "network.start": network.start}).sort({"created": this.DESCENDING}).limit(1).toArray(callback);
    
}

Database.prototype.updateNetwork = function(network, callback) {

  /*
   * Function Database.supersedeNetwork
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

  /*
   * Function Database.supersedeLatest
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

  /*
   * Function Database.supersedeFileByHash
   * Supersedes a single metadata document by hash
   * The network session identifier is passed to check authorization
   */

  function getQuery(session, hash) {

    /*
     * Function Database.supersedeFileByHash::getQuery
     * Returns the query dependent on the role of the user
     */

    switch(session.role) {
      case this.ROLES.ADMINISTRATOR:
        return {"sha256": hash}
      default:
        return {"network.code": session.prototype.network.code, "network.start": session.prototype.network.start, "sha256": hash}
    }

  }

  this.supersedeLatest(getQuery.call(this, session, hash), callback);

}

Database.prototype.getFileByHash = function(hash, callback) {

  /*
   * Function Database.getFileByHash
   * Returns the metadata identified by its SHA256 hash
   */

  this.files().findOne({"sha256": hash}, callback);

}

Database.prototype.getFilesByStation = function(session, queryString, callback) {

  /*
   * Function Database.getFilesByStation
   * Returns the list of metadata files identified by its network, station code
   */

  function getQuery(session, queryString) {

    /*
     * Function Database.getFilesByStation::getQuery
     * Returns the query based on the role of the user
     * Administrators have global access 
     */

    switch(session.role) {
      case this.ROLES.ADMINISTRATOR: 
        return {"station": queryString.station, "network.code": queryString.network}
      default:
        return {"station": queryString.station, "network.code": session.prototype.network.code, "network.start": session.prototype.network.start}
    }

  }

  var findQuery = getQuery.call(this, session, queryString);

  this.files().find(findQuery).toArray(callback);

}

Database.prototype.getNewMessageCount = function(id, callback) {

  /*
   * Function Database.getNewMessageCount
   * Returns the number of new (unread) messages
   */

  this.messages().find({"recipient": this.ObjectId(id), "read": false, "recipientDeleted": false}).count(callback);

}

Database.prototype.getMessages = function(id, callback) {

  /*
   * Function Database.getMessages
   * Returns an array of messages (sent or received)
   */

  this.messages().find({"$or": [{"recipient": this.ObjectId(id), "recipientDeleted": false }, {"sender": this.ObjectId(id), "senderDeleted": false}]}).sort({"created": this.DESCENDING}).toArray(callback);

}

Database.prototype.getMessageById = function(id, messageId, callback) {

  /*
   * Function Database.getMessageById
   * Returns a single message identified by its MongoDB ObjectId
   */

  this.messages().findOne({"_id": this.ObjectId(messageId), "$or": [{"recipient": this.ObjectId(id), "recipientDeleted": false}, {"sender": this.ObjectId(id), "senderDeleted": false}]}, callback);

}

Database.prototype.getSessionUser = function(sessionIdentifier, callback) {

  /* 
   * Function Databasr.getSessionUser
   * Returns an user object from a session identifier
   */

  // No session cookie is available
  if(sessionIdentifier === null) {
    return callback(null, null);
  }

  this.getSession(sessionIdentifier, function(error, session) {

    // Error querying the database
    if(error) {
      return callback(error);
    }

    // The session does not exist
    if(session === null) {
      return callback(null, null);
    }

    // Get the user that belongs to the session
    this.getUserById(session.userId, function(error, user) {

      // Error querying the database
      if(error) {
        return callback(error);
      }

      // No error but no user could be found
      if(user === null) {
        return callback(null, null);
      }

      this.getActivePrototype(user.network, function(error, documents) {

        // Error querying the database
        if(error) {
          return callback(error);
        }

        // Administrators can go without a prototype
        if(user.role === this.ROLES.ADMINISTRATOR) {
          return callback(null, new User(user, sessionIdentifier, null));
        }

        // No error but no prototype could be found: disable user
        if(documents.length === 0) {
          return callback(null, null);
        }

        // Callback with the authenticated user
        callback(null, new User(user, sessionIdentifier, documents.pop()));

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

Database.prototype.getAcceptedInventory = function(callback) {

  /*
   * Function Database.getAcceptedInventory
   * Returns the list of accepted metadata from the database
   */

  // The pipeline for getting all most recent metadata flagged as ACCEPTED or COMPLETED per station
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

Database.prototype.createSession = function(user, callback) {

  /*
   * Function Database.createSession
   * Creates a new session in the database
   */

  // Create a new session for the user
  var session = new Session();

  // Metadata to store in the session collection
  var storeObject = {"sessionId": session.id, "userId": user._id, "created": new Date()}

  // Insert a new session
  this.sessions().insertOne(storeObject, function(error, result) {

    if(error) {
      return callback(error);
    }

    callback(null, session);

  });

}


Database.prototype.writeSubmittedFiles = function(id, XMLDocuments, callback) {

  /*
   * Function Database.writeSubmittedFiles
   * Concurrently writes all submitted XMLDocuments to disk and metadata to the database
   */

  function FileMetadata(id, metadata) {

    /*
     * Function Database.writeSubmittedFiles::FileMetadata
     * Returns an object containing file metadata
     */

    var now = new Date();

    return {
      "userId": id,
      "status": this.METADATA_STATUS_PENDING,
      "type": "FDSNStationXML",
      "filename": metadata.id,
      "network": metadata.network,
      "station": metadata.station,
      "nChannels": metadata.nChannels,
      "filepath": path.join(metadata.filepath, metadata.sha256),
      "size": metadata.size,
      "sha256": metadata.sha256,
      "error": null,
      "available": null,
      "modified": now,
      "created": now
    }

  }

  var next;
  var submittedFiles = new Array();

  // Asynchronous writing for multiple files to disk and
  // adding metadata to the database
  (next = function() {

    // Finished writing all documents
    if(!XMLDocuments.length) {

      // Write a private message to each administrator
      this.messageAdministrators(id, submittedFiles);

      // Fire callback without an error
      return callback(null);

    }

    // Get the next queued file
    var file = XMLDocuments.pop();

    // Create a file metadata object
    var metadata = FileMetadata.call(this, id, file.metadata);

    // Status to ignore
    var statusIgnore = [
      this.METADATA_STATUS_TERMINATED,
      this.METADATA_STATUS_REJECTED,
      this.METADATA_STATUS_SUPERSEDED
    ];

    // Check if the file (sha256) is already in the database
    // Since it is pointless to store multiple objects for the same file
    // Superseded files ALWAYS stay in the database to keep the history complete
    this.files().findOne({"sha256": metadata.sha256, "status": {"$nin": statusIgnore}}, function(error, document) {

      if(error) {
        return callback(error);
      }

      // Document is already in database: continue with next
      if(document !== null) {
        return next();
      }

      // First insert the new (or updated) metadata document
      this.files().insertOne(metadata, function(error, document) {

        if(error) {
          return callback(error);
        }

        // NodeJS stdlib for writing file
        fs.writeFile(path.join(metadata.filepath + ".stationXML"), file.data, function(error) {

          if(error) {
            return callback(error);
          }

          // Supersede previous metadata documents (outdated metadata)
          this.supersedeFileByStation(document.insertedId, metadata, function(error) {

            if(error) {
              return callback(error);
            }

            // Save the written filename for a message sent to the administrators
            submittedFiles.push(metadata.filename);

            // More files to write
            next();

          }.bind(this));

        }.bind(this));

      }.bind(this));

    }.bind(this));

  }.bind(this))();

}

Database.prototype.messageAdministrators = function(id, filenames) {

 /*
  * Function Database.messageAdministrators
  * Messages administrators with a message
  */

  const MESSAGE_SUBJECT = "New Metadata Upload";

  // No files were uploaded
  if(filenames.length === 0) {
    return;
  }

  // Get all ORFEUS administrators
  this.getAdministrators(function(error, administrators) {

    if(error) {
      return logger.error(error);
    }

    // No administrators
    if(administrators.length === 0) {
      return logger.info("No administrators could be found");
    }

    // Message each administrator but skip messaging self
    var messages = administrators.filter(x => x._id.toString() !== id.toString()).map(function(administrator) {

      return Message(
        administrator._id,
        id,
        MESSAGE_SUBJECT,
        "New metadata has been submitted for station(s): " + filenames.map(escapeHTML).join(", ")
      );

    });

    if(messages.length === 0) {
      return;
    }

    // Store the messages
    this.storeMessages(messages, function(error, result) {

      if(error) {
        logger.error(error);
      } else {
        logger.info("Messaged " + administrators.length + " adminstrators about " + filenames.length + " file(s) uploaded.");
      }

    });

  }.bind(this));

}

Database.prototype.getStagedFiles = function(session, callback) {

  /*
   * Function Database.getStagedFiles
   * Gets the files that are staged from the database
   */

  var findQuery = {
    "status": {
      "$in": [
        this.METADATA_STATUS_REJECTED,
        this.METADATA_STATUS_PENDING,
        this.METADATA_STATUS_CONVERTED,
        this.METADATA_STATUS_VALIDATED,
        this.METADATA_STATUS_ACCEPTED
      ]
    }
  }

  // Filter anything that does not belong to the user
  if(!session.isAdministrator()) {
    findQuery["network.code"] = session.prototype.network.code;
    findQuery["network.start"] = session.prototype.network.start;
  }

  // Parameters to be included in the response
  var include = {
    "status": 1,
    "error": 1,
    "sha256": 1,
    "nChannels": 1,
    "network": 1,
    "size": 1,
    "created": 1,
    "station": 1
  }

  this.files().find(findQuery).project(include).toArray(callback);

}

Database.prototype.setMessageRead = function(id) {

  /*
   * Function Database.setMessageRead
   * Sets message with particular id to being read by the recipient
   */

  this.messages().updateOne({"_id": id}, {"$set": {"read": true}});

}

Database.prototype.getSeedlinkServers = function(session, callback) {

  /*
   * Function Database.getSeedlinkServers
   * Gets submitted seedlink servers from the database
   */

  if(session.role === this.ROLES.ADMINISTRATOR) {
    this.seedlink().find().toArray(callback);
  } else {
    this.seedlink().find({"userId": session._id}).toArray(callback);
  }

}

Database.prototype.setAvailable = function(ids, callback) {

  /*
   * Function Database.setAvailable
   * Sets document status inside ids array to COMPLETED
   */

  this.files().updateMany({"_id": {"$in": ids}}, {"$set": {"status": this.METADATA_STATUS_COMPLETED}}, function(error, count) {

    if(error) { 
      return callback(error);
    }

    callback(null);

  });

}

Database.prototype.addUser = function(postBody, callback) {

  /*
   * Function Database.addUser
   * Adds a new user to the database
   */

  // Get a random salt and hash the submitted password
  var salt = randomId(32);

  // Add the salt and hash the password for saving
  var passwordHash = SHA256(postBody.password + salt);
  var role = Number(postBody.role);

  // Do some sanity checks
  if(!Object.prototype.hasOwnProperty.call(postBody, "username") || postBody.username === "") {
    return callback(new Error("The submitted username field is empty"));
  }

  if(!Object.prototype.hasOwnProperty.call(postBody, "password") || postBody.password === "") {
    return callback(new Error("The submitted password field is empty"));
  }

  // Confirm re-entered password
  if(!Object.prototype.hasOwnProperty.call(postBody, "repassword") || postBody.password !== postBody.repassword) {
    return callback(new Error("The submitted password does not match the re-entered password"));
  }

  if(!Object.prototype.hasOwnProperty.call(postBody, "prototype")) {
    return callback(new Error("No network prototype was selected"));
  }

  // Check if the application role exists
  if(!Object.values(this.ROLES).includes(role)) {
    return callback(new Error("An unknown role was requested that is not configured as available"));
  }

  // Check if the user already exists
  this.getUserByName(postBody.username, function(error, document) {

    if(error) {
      return callback(error);
    }

    if(document !== null) {
      return callback(new Error("A user with this username already exists"));
    }

    var [code, start] = postBody.prototype.split(" ");
    var network = {"start": new Date(start), "code": code}

    // Get the active prototype for the network
    this.getActivePrototype(network, function(error, documents) {

      if(error) {
        return callback(error);
      }

      if(documents.length === 0) {
        return callback(new Error("The requested prototype could not be found: " + JSON.stringify(network)));
      }

      // User object to be stored in the database
      var userObject = {
        "username": postBody.username,
        "password": passwordHash,
        "salt": salt,
        "network": documents.pop().network,
        "role": role,
        "created": new Date(),
        "version": CONFIG.__VERSION__,
        "visited": null
      }

      // Add the MongoDB user document
      this.users().insertOne(userObject, callback);

    }.bind(this));

  }.bind(this));

}

Database.prototype.readPrototypeDirectory = function(callback) {

  /*
   * Function Database.readPrototypeDirectory
   * Reads the contents of the prototype directory
   */

  const PROTOTYPE_DIR = "./prototypes";

  // Read all prototypes from the directory
  fs.readdir(PROTOTYPE_DIR, function(error, files) {

    // Propogate the error
    if(error) {
      return callback(error);
    }

    // Collect .xml files and add filepath to filenames
    callback(null, files.filter(x => x.endsWith(".xml")).map(x => path.join(PROTOTYPE_DIR, x)));

  });

}

Database.prototype.updateUserVisit = function(id) {

  /*
   * Function Database.updateUserVisit
   * Updates metadata for user visiting the portal
   */

  this.users().updateOne({"_id": id}, {"$set": {"version": CONFIG.__VERSION__, "visited": new Date()}});

}

Database.prototype.updateAllPrototypes = function(sessionId, callback) {

  /*
   * Function WebRequest.updateAllPrototypes
   * Updates all the network prototypes
   */

  // Synchronously make sure the directory exists
  createDirectory("./metadata/prototypes");

  // Collect all files from the prototype directory
  this.readPrototypeDirectory(function(error, files) {

    if(error) {
      return callback(error);
    }

    var nextFile;

    // Async but concurrently read all files
    (nextFile = function() {

      // All buffers were read and available
      if(!files.length) {
        return callback(null);
      }

      // Delegate handling of prototype update
      this.handlePrototypeUpdate(files.pop(), sessionId, function(error) {

        if(error) {
          return callback(error);
        }

        nextFile();

      });

    }.bind(this))();

  }.bind(this));

}

Database.prototype.handlePrototypeUpdate = function(file, sessionId, callback) {

  /*
   * Function WebRequest.handlePrototypeUpdates
   * Updates the network prototype definitions to the database
   */

  fs.readFile(file, function(error, buffer) {

    // Propogate error
    if(error) {
      return callback(error);
    }

    // Try parsing the prototype files and extracting attributes
    // (e.g. restrictedStatus, start, end, description)
    try {
      var parsedPrototype = parsePrototype(buffer);
    } catch(exception) {
      return callback(exception);
    }

    // Get the currently active prototype for that network
    this.getActivePrototype(parsedPrototype.network, function(error, documents) {

      // Propogate error
      if(error) {
        return callback(error);
      }

      // Do nothing if the active prototype was resubmitted 
      if(documents.length !== 0 && parsedPrototype.sha256 === documents.pop().sha256) {
        return callback(null);
      }

      // Write the prototype to disk
      this.writePrototype(parsedPrototype, buffer, sessionId, callback);

    }.bind(this));

  }.bind(this));

}

Database.prototype.writePrototype = function(parsedPrototype, buffer, sessionId, callback) {

  /*
   * Function WebRequest.writePrototype
   * Writes the newly submitted network prototype to disk
   */

  // Otherwise proceed to write the prototype to disk
  fs.writeFile(parsedPrototype.filepath + ".stationXML", buffer, function(error) {

    // Propogate error
    if(error) {
      return callback(error);
    }

    var input = parsedPrototype.filepath + ".stationXML";
    var output = parsedPrototype.filepath + ".sc3ml";

    seisComP3.convertSC3ML(input, output, function(error) {

      if(error) {
        return callback(error);
      }

      this.addPrototype(parsedPrototype, function(error, result) {

        // Propogate error
        if(error) {
          return callback(error);
        }

        logger.info("Inserted new network prototype for " + JSON.stringify(parsedPrototype.network));

        // A new network prototype was submitted (or changed) and we are required to supersede all metadata from this network
        // In this case, all stations from the network will be updated to match the new prototype
        // have their descriptions, restrictedStatus changed
        this.updateNetwork(parsedPrototype.network, function(error, files) {

          // Propogate error
          if(error) {
            return callback(error);
          }

          // Nothing to do
          if(files.length === 0) {
            return callback(null);
          }

          // Update all submitted StationXML to match the prototype definition
          var XMLDocuments = updateStationXML(parsedPrototype, files);

          // Call routine to write all updated files
          this.writeSubmittedFiles(sessionId, XMLDocuments, callback);

        }.bind(this));

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

Database.prototype.RPCDatabase = function(callback) {

  /*
   * Function Database.RPCDatabase
   * Call to update the SeisComP3 database
   */

  logger.info("RPC for database update received.");

  const inventoryFile = path.join("seiscomp3", "etc", "inventory", "inventory.xml");

  // Attempt to remove the previous merged XML
  fs.unlink(inventoryFile, function(error) {

    // ENOENT means file does not exist
    if(error && error.code !== "ENOENT") {
      return callback(error);
    }

    // Get the accepted inventory from the database
    this.getAcceptedInventory(function(error, documents) {

      if(error) {
        return callback(error);
      }

      // No metadata in the database
      if(documents.length === 0) {
        return callback(null);
      }

      var files = documents.map(x => x.filepath + ".sc3ml");

      seisComP3.mergeSC3ML(files, inventoryFile, function(error) {

        if(error) {
          return callback(error);
        }

        logger.info("RPC merged full inventory of " + documents.length + " files. Exited with status code " + code + ".");

        this.RPCUpdateInventory(documents, callback);

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

Database.prototype.restartFDSNWS = function(callback) {

  /*
   * Function Database.restartFDSNWS
   * Wrapper for restarting the SeisComP3 FDSN Station Webservice
   */

  seisComP3.restartFDSNWS(callback);

}

Database.prototype.RPCUpdateInventory = function(documents, callback) {

  /*
   * Function Database.RPCUpdateInventory
   * Updates the internal SeisComP3 inventory and restarts FDSNWS
   */

  seisComP3.updateInventory(function(error) {

    logger.info("SeisComP3 database has been updated. Exited with status code " + code + ".");

    // Error updating the database
    if(error) {
      return callback(error);
    }

    // Set all submitted files to being available/completed
    this.setAvailable(documents.map(x => x.id), function(error) {

      if(error) {
        return callback(error);
      }

      this.restartFDSNWS(function(error) {

        if(error) {
          return callback(error);
        }

        return callback(null);

      });

    }.bind(this));

  }.bind(this));

}

Database.prototype.streamAcceptedInventory = function(outstream, callback) {

  /*
   * Function Database.streamAcceptedInventory
   * Streams the accepted inventory to the HTTP response object
   */

  const FILENAME = CONFIG.NODE.ID + "-sc3ml-full-inventory";

  logger.info("RPC for full inventory received.");

  // Query the database for all accepted files
  this.getAcceptedInventory(function(error, documents) {

    if(error) {
      return callback(error);
    }

    if(documents.length === 0) {
      return callback(null);
    }

    logger.info("RPC is merging " + documents.length + " inventory files.");

    var files = documents.map(x => x.filepath + ".sc3ml");

    // Pass writeable as output file
    // Do not fire the callback explicitly
    seisComP3.mergeSC3ML(files, outstream, function(error) {

      if(error) {
        return callback(error);
      }

      logger.info("RPC merged full inventory of " + documents.length + " files.");

    });

  }.bind(this));

}

module.exports = new Database();

// Native includes
const { createServer } = require("http");
const path = require("path");
const url = require("url");
const fs = require("fs");
const querystring = require("querystring");

const multipart = require("./lib/multipart");

// ORFEUS libs
const Database = require("./lib/orfeus-database");
const Session = require("./lib/orfeus-session");
const Console = require("./lib/orfeus-logging");
const SHA256 = require("./lib/orfeus-crypto");
const OHTTP = require("./lib/orfeus-http");
const Template = require("./lib/orfeus-template");
const { sum, createDirectory, escapeHTML } = require("./lib/orfeus-util");
const { splitStationXML } = require("./lib/orfeus-metadata.js");

const CONFIG = require("./config");

function getSession(headers, callback) {

  /* function getSession
   * Attempts to get a session identifier by a header cookie
   * from the sessions database
   */

  if(Database.connection() === null) {
    return callback(true, null);
  }

  // Cookie not set in HTTP request headers
  if(headers.cookie === undefined) {
    return callback(null, null);
  }

  // Parse the cookie header and get the SESSION_ID
  var cookie = querystring.parse(headers.cookie.split(";")[0]);
  var sessionQuery = {"SESSION_ID": cookie.SESSION_ID};

  Database.sessions().findOne(sessionQuery, function(error, session) {

    // Error or session could not be found
    if(error || session === null) {
      return callback(null, null);
    }

    Database.users().findOne({"_id": session.userId}, function(error, user) {

      // Error or no user could be found
      if(error || user === null) {
        return callback(null, null);
      }

      // Callback with a new authenticated user
      callback(null, new User(user, cookie.SESSION_ID));

    });

  });

}

var User = function(user, id) {

  /* Class User
   * Holds user information
   */

  this._id = user._id;
  this.sessionId = id;
  this.username = user.username;
  this.network = user.network;
  this.version = user.version;
  this.visited = user.visited;
  this.role = user.role;

}

function Init() {

  /* function Init
   * Initializes the application
   */

  const DATABASE_CONNECTION_ERROR = "Could not open connection to the database.";

  // Attempt to connect to the database
  Database.connect(function(error) {
  
    // Could not connect to Mongo
    if(error) {
      return Console.fatal(DATABASE_CONNECTION_ERROR);
    }
  
    // Create a new webserver
    new Webserver();
  
  });

}

function createSession(user, callback) {

  /* function createSession
   * Creates a new session
   */

  // Cookie function to make a string
  function Cookie(session) {
    return "SESSION_ID=" + session.id + "; Expires=" + session.expiration.toUTCString();
  }

  var session = new Session(user);

  var storeObject = {
    "SESSION_ID": session.id,
    "userId": user._id,
    "created": new Date()
  }

  // Insert a new session
  Database.sessions().insertOne(storeObject, function(error, result) {

    const STATUS_MESSAGE = "Created session for " + user.username + " (" + session.id + ").";

    error ? Console.error(STATUS_MESSAGE) : Console.info(STATUS_MESSAGE);

    // Error creating a session
    if(error) {
      return callback(null);
    }

    callback(Cookie(session));

  });

}

function monkeyPatchResponse(request, response) {

  /* function monkeyPatchResponse
   * Patches response object and adds some information
   */

  const CACHE_CONTROL_HEADER = "private, no-cache, no-store, must-revalidate";

  // Prevent browser-side caching of sessions
  response.setHeader("Cache-Control", CACHE_CONTROL_HEADER);
  response.bytesWritten = 0;

  // Monkey patch the response write function
  // To keep track of number of bytes shipped
  response.write = (function(closure) {
    return function(chunk) {
      response.bytesWritten += chunk.length;
      return closure.apply(this, arguments);
    }
  })(response.write);

  // Response finish write to log
  response.on("finish", function() {

    const clientIP = request.headers["x-forwarded-for"] || request.connection.remoteAddress || null;
    const userAgent = request.headers["user-agent"] || null

    // HTTPD access log 
    Console.debug([
      clientIP,
      url.parse(request.url).pathname,
      request.method,
      response.statusCode,
      response.bytesWritten,
      userAgent
    ].join(" "));

  });

}

function serveStaticFile(response, uri) {

  /* function serveStaticFile
   * Servers static file to request
   */

  switch(path.extname(uri)) {
    case ".json":
      response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "application/json"}); break;
    case ".css":
      response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "text/css"}); break;
    case ".png":
      response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "image/png"}); break;
    case ".js":
      response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "application/javascript"}); break;
  }

  return fs.createReadStream(path.join("static", uri)).pipe(response);

}

var Webserver = function() {

  /* Class Webserver
   * Opens NodeJS webservice on given PORT
   * Handles all incoming connections
   */

  // Static files to be served
  const STATIC_FILES = require("./lib/orfeus-static");

  // Call the metaDaemon
  if(CONFIG.METADATA.DAEMON.ENABLED) {
    require("./lib/orfeus-metadaemon");
  }

  // Create the HTTP server and listen to incoming requests
  var webserver = createServer(function(request, response) {
  
    const uri = url.parse(request.url).pathname;
    const search = url.parse(request.url).search;

    // Extend response object
    monkeyPatchResponse(request, response);

    // Serve static file
    if(STATIC_FILES.indexOf(uri) !== -1) {
      return serveStaticFile(response, uri);
    }

    // Redirect webserver root to the login page
    if(uri === "/") {
      return OHTTP.Redirect(response, "/login");
    }

    /* 
     * An authenticated session may be required
     */

    getSession(request.headers, function(error, session) {
  
      // Attach the session to the request
      request.session = session;

      // ORFEUS Manager log in page
      if(uri.startsWith("/login")) {
  
        // If the user is already logged in redirect to home page
        if(request.session !== null) {
          return OHTTP.Redirect(response, "/home");
        }
  
        // Get request is made on the login page
        response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "text/html"});
        return response.end(Template.generateLogin(request.url));
  
      }

      // When the database connection fails
      if(error) {
        return OHTTP.HTTPError(response, OTTHP.E_HTTP_INTERNAL_SERVER_ERROR);
      }

      // Service is closed
      if(CONFIG.__CLOSED__) {
        return OHTTP.HTTPError(response, OHTTP.E_HTTP_UNAVAILABLE);
      }
  
      // Method for authentication
      if(uri === "/authenticate") {
  
        // Only implement POST request
        if(request.method !== "POST") {
          return OHTTP.HTTPError(response, OHTTP.E_HTTP_NOT_IMPLEMENTED);
        }
        
        // Attempt to parse the POST body passed by the HTML form
        // Contains username and password
        OHTTP.parseRequestBody(request, response, "json", function(postBody) {
  
          // Check the user credentials
          Authenticate(postBody, function(error, user) {
  
            // Authentication failed
            if(error) {
              return OHTTP.Redirect(response, "/login?" + error);
            }
  
            // Create a new session for the user
            createSession(user, function(cookie) {
  
              // Could not get a cookie from the jar
              if(cookie === null) {
                return OHTTP.HTTPError(response, OHTTP.E_HTTP_INTERNAL_SERVER_ERROR);
              }

              // Redirect user to home page and set a cookie for this session
              response.writeHead(OHTTP.S_HTTP_REDIRECT, {
                "Set-Cookie": cookie,
                "Location": "./home?welcome"
              });
  
              response.end();
  
            });
  
          });
  
        });
  
        return;
  
      }
  
      // Roadblock for non-authenticated sessions
      if(request.session === null) {
        return OHTTP.HTTPError(response, OHTTP.E_HTTP_UNAUTHORIZED);
      }

      /* +-----------------------------------+
       * | PROTECTED AREA                    |
       * | REQUIRES AN AUTHENTICATED SESSION |
       * +-----------------------------------+
       */
  
      // Forward the request to the API
      if(uri.startsWith("/api")) {
        return APIRequest(request, response); 
      }
  
      // User wishes to log out
      if(uri === "/logout") {
  
        // Destroy the session
        Database.sessions().deleteOne({"SESSION_ID": request.session.sessionId}, function(error, result) {

          const STATUS_MESSAGE = "Removed session for " + request.session.username + " (" + request.session.sessionId + ")";

          error ? Console.error(STATUS_MESSAGE) : Console.info(STATUS_MESSAGE);

          OHTTP.Redirect(response, "/login?S_LOGGED_OUT");

        });

        return;
  
      }
  
      // URL for posting messages
      if(uri === "/send") {

        // Parse the POSTed request body as JSON
        OHTTP.parseRequestBody(request, response, "json", function(postBody) {

          // Disallow message to be sent to self
          if(postBody.recipient === request.session.username) {
            return OHTTP.Redirect(response, "/home/messages/new?self");
          }

          // Admin may sign broadcasted message
          if(postBody.recipient === "broadcast" && request.session.role === "admin") {
            var userQuery = {"username": {"$not": {"$eq": request.session.username}}}
          } else if(postBody.recipient === "administrators") {
            var userQuery = {"role": "admin", "username": {"$not": {"$eq": request.session.username}}}
          } else {
            var userQuery = {"username": postBody.recipient}
          }

          // Query the user database for the recipient name
          Database.users().find(userQuery).toArray(function(error, users) {

            // Unknown recipient
            if(users.length === 0) {
              return OHTTP.Redirect(response, "/home/messages/new?unknown");
            }

            // Create a new message
            const messageBody = users.map(function(user) {
              return Message(
                user._id,
                request.session._id,
                escapeHTML(postBody.subject),
                escapeHTML(postBody.content)
              )
            });

            // Store all messages
            Database.messages().insertMany(messageBody, function(error, result) {

              // Error storing messages
              if(error) {
                return OHTTP.Redirect(response, "/home/messages/new?failure");
              }

              OHTTP.Redirect(response, "/home/messages/new?success");

            });

          });

        });

        return;

      }

      // Profile page
      if(uri === "/home") {

        // Update the last visit & app. version
        if(search === "?welcome") {
          Database.users().updateOne({"_id": request.session._id}, {"$set": {"version": CONFIG.__VERSION__, "visited": new Date()}});
        }

        return response.end(Template.generateProfile(request.session));

      }

      if(uri === "/home/messages") {
        return response.end(Template.generateMessages(request.session));
      }

      if(uri === "/home/messages/new") {
        return response.end(Template.generateNewMessageTemplate(request.url, request.session));
      }

      if(uri.startsWith("/home/messages/detail")) {
        return response.end(Template.generateMessageDetails(request.session));
      }
   
      // Station details page
      if(uri === "/home/station") {
        return response.end(Template.generateStationDetails(request.session));
      }

      // Method for submitting a new seedlink server
      if(uri === "/seedlink") {

        // Only accept POST requests
        if(request.method !== "POST") {
          return OHTTP.HTTPError(response, OHTTP.E_HTTP_NOT_IMPLEMENTED);
        }

        OHTTP.parseRequestBody(request, response, "json", function(json) {

          const IPV4_ADDRESS_REGEX  = new RegExp("^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$");
          const HOSTNAME_REGEX = new RegExp("^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$");

          const port = Number(json.port);

          // Confirm hostname or IPv4
          if(!IPV4_ADDRESS_REGEX.test(json.host) && !HOSTNAME_REGEX.test(json.host)) {
            return OHTTP.Redirect(response, "/home?E_SEEDLINK_HOST_INVALID");
          }

          // Accept ports between 0x0400 and 0xFFFF
          if(isNaN(port) || port < (1 << 10) || port > (1 << 16)) {
            return OHTTP.Redirect(response, "/home?E_SEEDLINK_PORT_INVALID");
          }

          // Store new seedlink object in database
          var storeObject = {
            "userId": request.session._id,
            "host": json.host,
            "port": port, 
            "created": new Date()
          }

          // Only insert new seedlink servers
          Database.seedlink().find({"userId": request.session._id, "host": json.host, "port": port}).count(function(error, count) {

            if(error) {
              return OHTTP.Redirect(response, "/home?E_INTERNAL_SERVER_ERROR");
            }

            // The server is already in the database
            if(count !== 0) {
              return OHTTP.Redirect(response, "/home?E_SEEDLINK_SERVER_EXISTS");
            }

            Database.seedlink().insertOne(storeObject, function(error, result) {
              return OHTTP.Redirect(response, "/home?" + (error ? "E_INTERNAL_SERVER_ERROR" : "S_SEEDLINK_SERVER_SUCCESS"));
            });

          });
 
        });

        return;

      }

      // Uploading files
      if(uri === "/upload") {
  
        if(request.method !== "POST") {
          return OHTTP.HTTPError(response, OHTTP.E_HTTP_NOT_IMPLEMENTED);
        }
  
        // Parse the POST body (binary file)
        OHTTP.parseRequestBody(request, response, "multiform", function(files) {

          // Only accept files with content 
          var files = files.filter(function(x) {
            return x.data.length !== 0;
          });

          // Write (multiple) files to disk
          writeMultipleFiles(files, request.session, function(error) {

            if(error) {
              Console.error(error);
            }

            return OHTTP.Redirect(response, "/home?" + (error ? "E_METADATA_ERROR" : "S_METADATA_SUCCESS")); 

          });
          
        });
  
        return;
  
      }

      // No route matched: send 404
      return OHTTP.HTTPError(response, OHTTP.E_HTTP_FILE_NOT_FOUND);
  
    });
  
  });

  // Listen to incoming connections
  webserver.listen(CONFIG.PORT, CONFIG.HOST, function() {
    Console.info("Webserver started at " + CONFIG.HOST + ":" + CONFIG.PORT);
  });

  // Graceful shutdown of server
  process.on("SIGINT", function () {
    Console.info("SIGINT received: closing webserver");
    //webserver.close(function() {
      Console.info("Webserver has been closed");
      process.exit(0);
    //});
  });

}

function writeMultipleFiles(files, session, callback) {

  /* function writeMultipleFiles
   * Writes multiple (split) StationXML files to disk
   */

  var XMLDocuments;

  // We split any submitted StationXML files
  try {
    XMLDocuments = splitStationXML(files);
  } catch(exception) {
    return callback(exception);
  }

  // Confirm user is manager of the network
  for(var i = 0; i < XMLDocuments.length; i++) {
    if(session.network !== XMLDocuments[i].metadata.network) {
      return callback(true); 
    }
  }

  // Create a copy of all metadata
  XMLMetadata = XMLDocuments.map(function(x) {
    return x.metadata;
  });

  // Create directories
  XMLMetadata.forEach(function(x) {
    createDirectory(x.filepath);
  });

  // Write a message to the administrators
  messageAdministrators(XMLMetadata, session);

  // Write file metadata to the database
  saveFilesObjects(XMLMetadata, session);

  if(XMLDocuments.length === 0) {
    return callback(null);
  }

  // Asynchronous writing for multiple files to disk
  (writeFile = function() {

    var file = XMLDocuments.pop();

    var STATUS_MESSAGE = "Writing file " + file.metadata.sha256 + " (" + file.metadata.id + ") to disk";

    // NodeJS std lib for writing file
    fs.writeFile(path.join(file.metadata.filepath, file.metadata.sha256 + ".stationXML"), file.data, function(error) {

      // Write to log
      error ? Console.error(STATUS_MESSAGE) : Console.info(STATUS_MESSAGE);

      if(error) {
        return callback(error);
      }

      // Done writing
      if(XMLDocuments.length === 0) {
        return callback(null)
      }

      // More files to write
      writeFile();
      
    });

  })();

}

function getAdministrators(callback) {

  /* function getAdministrators
   * Returns documents for all administrators
   */
 
  const queryObject = {"role": "admin"}

  Database.users().find(queryObject).toArray(function(error, users) {

    if(error || users.length === 0) {
      return callback(new Array());
    }

    callback(users);

  });

}

function saveFilesObjects(metadata, session) {

  /* function saveFilesObjects
   * writes new file objects to the database
   */

  // Store file information in the database
  var dbFiles = metadata.map(function(x) {
    return {
      "filename": x.id,
      "modified": null,
      "network": x.network,
      "station": x.station,
      "nChannels": x.nChannels,
      "filepath": path.join(x.filepath, x.sha256),
      "type": "FDSNStationXML",
      "size": x.size,
      "status": Database.METADATA_STATUS_PENDING,
      "userId": session._id,
      "created": new Date(),
      "sha256": x.sha256
    }
  });

  // Asynchronously store all file objects
  Database.files().insertMany(dbFiles, function(error) {

    if(error) {
      Console.error("Could not add file objects to the database");
    }

  });

}

function Message(recipient, sender, subject, content) {

  /* function Message
   * Creates default object for message with variable content
   */

  return {
    "recipient": recipient,
    "sender": sender,
    "subject": subject,
    "content": content,
    "read": false,
    "recipientDeleted": false,
    "senderDeleted": false,
    "created": new Date(),
    "level": 0
  }

}

function messageAdministrators(metadata, sender) {

  /* function messageAdministrators
   * Queries the database for all administrators
   */

  // No files were uploaded
  if(metadata.length === 0) {
    return;
  }

  // Get all ORFEUS administrators
  getAdministrators(function(users) {

    if(users.length === 0) {
      return
    }

    var messages = new Array();

    // Message each administrator
    users.forEach(function(user) {

      // Skip message to self
      if(user._id.toString() === sender._id.toString()) {
        return;
      }

      // Create one message per added station
      var filenames = metadata.map(function(file) {
        return escapeHTML(file.id);
      }).join(", ");

      messages.push(
        Message(
          user._id,
          sender._id,
          "Metadata added",
          "Metadata submitted for station(s): " + filenames
        )
      );

    });

    Console.debug("Messaged " + users.length + " adminstrators about " + metadata.length + " file(s) uploaded");
 
    // Store messages
    Database.messages().insertMany(messages, function(error, result) {

      if(error) {
        return;
      }

      Console.debug("Succesfully stored " + result.result.n + " new messages");

    });

  });

}

function APIRequest(request, response) {

  /* Fuction APIRequest
   * All requests to the ORFEUS API go through here
   */

  function APICallback(request, response, callback) {

    /* function APICallback
     * Wrapper for API callback
     */

    callback(request, OHTTP.writeJSON.bind(response));

  }

  // Get the URI from the request
  const uri = url.parse(request.url);
  const query = uri.query ? uri.query.split("&").shift() : null;

  // Bind the request & response to the API callback
  var APICallbackBound = APICallback.bind(this, request, response);

  // Register new routes here
  switch(uri.pathname) {
    case "/api/latency":
      return APICallbackBound(getStationLatencies);
    case "/api/seedlink":
      return APICallbackBound(GetSeedlinkServers);
    case "/api/staged":
      return APICallbackBound(getSubmittedFiles);
    case "/api/stations":
      return APICallbackBound(GetFDSNWSStations);
    case "/api/channels":
      return APICallbackBound(GetFDSNWSChannels);
    case "/api/messages":
      switch(query) {
        case "new":
          return APICallbackBound(GetNewMessages)
        case "deleteall":
          return APICallbackBound(RemoveAllMessages);
        case "deletesent":
          return APICallbackBound(RemoveAllMessagesSent);
        default:
          return APICallbackBound(GetMessages);
 
      }
    case "/api/messages/details":
      switch(request.method) {
        case "GET":
          return APICallbackBound(GetSpecificMessage);
        case "DELETE":
          return APICallbackBound(RemoveSpecificMessage);
        default:
          return OHTTP.HTTPError(response, OHTTP.E_HTTP_NOT_IMPLEMENTED);
      }
    default:
      return OHTTP.HTTPError(response, OHTTP.E_HTTP_FILE_NOT_FOUND);
  }

}

function GetSeedlinkServers(request, callback) {

  /* function GetSeedlinkServers
   * Returns submitted seedlink servers from the database
   */

  Database.seedlink().find({"userId": request.session._id}).toArray(function(error, results) {

    // There was an error or no results: show nothing
    if(error || results.length === 0) {
      return new Array();
    }

    var servers = results.map(function(x) {
      return x.host;
    })

    var servPort = results.map(function(x) {
      return x.host + ":" + x.port;
    }).join(",");

    // Query the DNS records
    OHTTP.getDNS(servers, function(DNSRecords) {

      // Get a list of all hosts
      var servers = DNSRecords.map(function(x) {
        return x.host;
      }).join(",");

      var hashMap = new Object();
      DNSRecords.forEach(function(x) {
        hashMap[x.host] = x.ip;
      });

      OHTTP.request("http://" + CONFIG.STATIONS.HOST + ":" + CONFIG.STATIONS.PORT + "?host=" + servPort, function(data) { 

        if(!data) {
          return callback(results);
        }

        data = JSON.parse(data);

        results.forEach(function(x) {
          for(var i = 0; i < data.length; i++) {
            if(data[i].host === x.host + ":" + x.port) {
              x.ip = hashMap[x.host] || "Unknown";
              x.identifier = data[i].identifier;
              x.connected = data[i].connected;
              x.version = data[i].version;

              if(data[i].stations === null) {
                x.stations = "Not Available";
              } else {
                x.stations = data[i].stations.filter(function(station) {
                  return station.network === request.session.network;
                });
              }

            }
          } 
        });

        callback(results);

      });

    });

  });

}

function RemoveAllMessagesSent(request, callback) {

  /* function RemoveAllMessages
   * Sets all messages for user to deleted
   */

  var query = {
    "sender": Database.ObjectId(request.session._id),
    "senderDeleted": false
  }

  // Get specific message from the database
  Database.messages().updateMany(query, {"$set": {"senderDeleted": true}}, function(error, messages) {
    callback(JSON.stringify(messages));
  });

}

function RemoveAllMessages(request, callback) {

  /* function RemoveAllMessages
   * Sets all messages for user to deleted
   */

  var query = {
    "recipient": Database.ObjectId(request.session._id),
    "recipientDeleted": false
  }

  // Get specific message from the database
  Database.messages().updateMany(query, {"$set": {"recipientDeleted": true}}, function(error, messages) {
    callback(JSON.stringify(messages));
  });

}

function RemoveSpecificMessage(request, callback) {

  /* function RemoveSpecificMessage
   * Sets message with particular id to deleted
   */

  // Get the message identifier from the query string
  var qs = querystring.parse(request.query);

  var senderQuery = {
    "sender": Database.ObjectId(request.session._id),
    "senderDeleted": false,
    "_id": Database.ObjectId(qs.id)
  }

  var recipientQuery = {
    "recipient": Database.ObjectId(request.session._id),
    "recipientDeleted": false,
    "_id": Database.ObjectId(qs.id)
  }

  // Get specific message from the database
  Database.messages().updateOne(recipientQuery, {"$set": {"recipientDeleted": true}}, function(error, message) {

    if(error || message.result.nModified === 0) {

      return Database.messages().updateOne(senderQuery, {"$set": {"senderDeleted": true}}, function(error, message) {

        if(error || message.result.nModified === 0) {
          return callback(JSON.stringify(null));
        }

        callback(JSON.stringify({"status": "deleted"}));

      });

    }

    callback(JSON.stringify({"status": "deleted"}));

  });

}

function GetSpecificMessage(request, callback) {

  /* function GetSpecificMessage
   * Returns a specific private message
   */

  var qs = querystring.parse(url.parse(request.url).query);

  // Get messages as sender or recipient (undeleted)
  var query = {
    "_id": Database.ObjectId(qs.id),
    "$or": [{
      "recipient": Database.ObjectId(request.session._id),
      "recipientDeleted": false
    }, {
      "sender": Database.ObjectId(request.session._id),
      "senderDeleted": false
    }]
  }

  // Get specific message from the database
  Database.messages().findOne(query, function(error, message) {

    // Could not find message
    if(error || message === null) {
      Console.error("Error getting single message from database.");
      return callback(null);
    }

    // Check if the author of the message is the owner of the session
    var author = message.sender.toString() === request.session._id.toString();

    // If requestee is not the author: set message to read
    if(!author) {
      Database.messages().updateOne(query, {"$set": {"read": true}});
    }

    // Find the username for the message sender 
    Database.users().findOne({"_id": Database.ObjectId(author ? message.recipient : message.sender)}, function(error, user) {

      if(error || user === null) {
        return callback(null);
      }

      // Message information
      var messageContent = {
        "contact": {"role": user.role, "username": user.username},
        "subject": message.subject,
        "content": message.content.replace(/\n/g, "<br>"),
        "created": message.created,
        "read": message.read,
        "author": author
      }

      callback(messageContent);

    });

  });

}

function GetNewMessages(request, callback) {

  /* function GetNewMessages
   * Return the number of new messages 
   */

  var query = {
    "recipient": Database.ObjectId(request.session._id),
    "read": false,
    "recipientDeleted": false
  }

  Database.messages().find(query).count(function(error, count) {
    callback({"count": count});
  });

}

function GetMessages(request, callback) {

  /* function GetMessages
   * Returns all messages that belong to a user in a session
   */

  const query = {
    "$or": [{
      "recipient": Database.ObjectId(request.session._id),
      "recipientDeleted": false
    }, {
      "sender": Database.ObjectId(request.session._id),
      "senderDeleted": false
    }]
  }

  // Query the database for all messages
  Database.messages().find(query).sort({"created": -1}).toArray(function(error, documents) {

    if(error) {
      Console.error("Error getting messages from database.");
    }

    if(documents.length === 0) {
      return callback(null);
    }

    // Get all messages where the user is either the sender or recipient
    const userQuery = {
      "_id": {
        "$in": documents.map(function(x) {
          return Database.ObjectId(x.sender);
        }).concat(documents.map(function(x) {
          return Database.ObjectId(x.recipient);
        }))
      }
    }

    // Get user names from user identifiers
    Database.users().find(userQuery).toArray(function(error, users) {

      if(error || users.length === 0) {
        Console.error("Error getting users from database.");
        return callback(null);
      }

      // Create a temporary hashMap that maps
      // {user._id} to {user.username}
      var hashMap = new Object();
      users.forEach(function(x) {
        hashMap[x._id] = {"username": x.username, "role": x.role};
      });

      // Create a JSON with the message contents
      var messageContents = documents.map(function(x) {

        return {
          "subject": x.subject,
          "sender": hashMap[x.sender],
          "recipient": hashMap[x.recipient],
          "created": x.created,
          "_id": x._id,
          "read": x.read,
          "author": x.sender.toString() === request.session._id.toString()
        }
      });
      
      callback(messageContents);

    });

  });

}

function getStationLatencies(request, callback) {

  /* function getStationLatencies
   * Returns Seedlink latencies for a network, station
   */

  var uri = url.parse(request.url);

  OHTTP.request("http://" + CONFIG.LATENCY.HOST + ":" + CONFIG.LATENCY.PORT + uri.search, function(data) {
    callback(JSON.parse(data));
  });

}


function GetFDSNWSChannels(request, callback) {

  /* function GetFDSNWSChannels
   * Returns the channels for a given station
   */

  var queryString = querystring.stringify({
    "level": "channel",
    "format": "text",
  });

  // Extend the query string
  queryString += "&" + url.parse(request.url).query;

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    callback(ParseFDSNWSResponse(json));
  });

}

function ParseFDSNWSResponse(data) {

  /* Function ParseFDSNWSResponse
   * Returns parsed JSON response from FDSNWS Station Webservice
   * for varying levels of information
   */

  if(data === null) {
    return JSON.stringify(new Array());
  }

  // Run through the response and convert to JSON
  return data.split("\n").slice(1, -1).map(function(line) {

    var codes = line.split("|");

    // Mapping of service to object
    switch(codes.length) {
      case 8:
        return {
          "network": codes[0],
          "station": codes[1],
          "position": {
            "lat": Number(codes[2]),
            "lng": Number(codes[3])
          },
          "elevation": Number(codes[4]),
          "description": codes[5],
          "start": codes[6],
          "end": codes[7]
        }
      case 17:
        return {
          "network": codes[0],
          "station": codes[1],
          "location": codes[2],
          "channel": codes[3],
          "position": {
            "lat": Number(codes[4]),
            "lng": Number(codes[5])
          },
          "description": codes[10],
          "gain": Number(codes[11]),
          "sensorUnits": codes[13],
          "sampleRate": Number(codes[14]),
          "start": codes[15],
          "end": codes[16]
        }
    }

  });

}

function getSubmittedFiles(request, callback) {

  /* function getSubmittedFiles
   * Abstracted function to read files from multiple directories
   * and concatenate the result
   */

  // Stages:
  // Pending -> Accepted | Rejected
  var pipeline = [{
    "$match": {
      "userId": Database.ObjectId(request.session._id),
    }  
  }, {
    "$group": {
      "_id": {
        "network": "$network",
        "station": "$station",
      },
      "created": {
        "$last": "$created"
      },
      "size": {
        "$last": "$size"
      },
      "status": {
        "$last": "$status"
      },
      "nChannels": {
        "$last": "$nChannels"
      },
      "modified": {
        "$last": "$modified"
      }
    }
  }, {
    "$match": {
      "status": {
        "$in": [
          Database.METADATA_STATUS_REJECTED,
          Database.METADATA_STATUS_PENDING,
          Database.METADATA_STATUS_CONVERTED,
          Database.METADATA_STATUS_VALIDATED,
          Database.METADATA_STATUS_ACCEPTED
        ]
      }
    }
  }];

  // Query the database for submitted files
  Database.files().aggregate(pipeline).toArray(function(error, files) {

    if(error) {
      return callback(error);
    }

    callback(files);

  });

}

function GetFDSNWSStations(request, callback) {

  /* Function GetFDSNWSStations
   * Returns station information from FDSNWS Station
   */

  // Hoist this
  var queryString = querystring.stringify({
    "level": "station",
    "format": "text",
    "network": request.session.network
  })

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    callback(ParseFDSNWSResponse(json));
  });

}

function Authenticate(postBody, callback) {

  /* function Authenticate
   * Attempts to authenticate the user with submitted username and password
   */

  Database.users().findOne({"username": postBody.username}, function(error, result) {

    // Username is invalid
    if(error || result === null) {
      return callback("E_USERNAME_INVALID");
    }

    if(result.password !== SHA256(postBody.password + result.salt)) {
      return callback("E_PASSWORD_INVALID");
    }

    return callback(null, result);

  });

}

Init();

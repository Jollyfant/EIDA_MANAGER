/* server.js
 * 
 * Main server code handling incoming HTTP requests
 * for the EIDA Manager
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

"use strict";

// Make require relative to the root directory
require("./require");

// Native includes
const { createServer } = require("http");
const path = require("path");
const url = require("url");
const fs = require("fs");
const querystring = require("querystring");

// Third-party libs
const multipart = require("./lib/multipart");

// ORFEUS libs
const Database = require("./lib/orfeus-database");
const { User, Session } = require("./lib/orfeus-session");
const Console = require("./lib/orfeus-logging");
const { SHA256 } = require("./lib/orfeus-crypto");
const OHTTP = require("./lib/orfeus-http");
const Template = require("./lib/orfeus-template");
const { sum, createDirectory, escapeHTML } = require("./lib/orfeus-util");
const { splitStationXML } = require("./lib/orfeus-metadata.js");

const CONFIG = require("./config");
const STATIC_FILES = require("./lib/orfeus-static");

function Init() {

  /* function Init
   * Initializes the application
   */


  // Attempt to connect to the database
  Database.connect(function(error) {
  
    // Could not connect to Mongo
    if(error) {
      Console.fatal(error);
      return setTimeout(Init, 5000);
    }
  
    // Create a new webserver
    new Webserver();
  
  });

}

var WebRequest = function(request, response) {

  /* Class WebRequest
   * Handles a single request to the HTTP webserver
   */

  this.request = request;
  this.response = response;
  this.session = null;

  this.uri = url.parse(request.url).pathname;
  this.search = url.parse(request.url).search;

  this.init();

}

WebRequest.prototype.logHTTPRequest = function() {

  /* Function WebRequest.logHTTPRequest
   * Writes HTTP summary to access log
   */

  // Extract the clientIP and User Agent
  const clientIP = this.request.headers["x-forwarded-for"] || this.request.connection.remoteAddress || null;
  const userAgent = this.request.headers["user-agent"] || null

  // Mimic HTTPD access log 
  Console.access([
    clientIP,
    url.parse(this.request.url).pathname,
    this.request.method,
    this.response.statusCode,
    this.response.bytesWritten,
    userAgent
  ].join(" "));

}

WebRequest.prototype.patchResponse = function() {

  /* WebRequest.patchResponse
   * Patches function keep track of shipped bytes
   */

  const CACHE_CONTROL_HEADER = "private, no-cache, no-store, must-revalidate";

  // Prevent browser-side caching of sessions
  this.response.setHeader("Cache-Control", CACHE_CONTROL_HEADER);

  this.response.bytesWritten = 0;

  // To keep track of number of bytes shipped
  this.response.write = (function(closure) {
    return function(chunk) {
      this.bytesWritten += chunk.length;
      return closure.apply(this, arguments);
    }
  })(this.response.write);

  // Response finish write to log
  this.response.on("finish", this.logHTTPRequest.bind(this));

}


WebRequest.prototype.init = function() {

  /* Function WebRequest.init
   * Initializes an instance of the WebRequest class
   */

  this._initialized = Date.now();

  // Patch the response
  this.patchResponse();

  // Static files are always served
  if(STATIC_FILES.includes(this.uri)) {
    return this.serveStaticFile(this.uri);
  }

  // Redirect webserver root to the login page
  if(this.uri === "/") {
    return this.redirect("/login");
  }

  // Attempt to get a running session
  this.getSession(this.handleSession);

}


WebRequest.prototype.serveStaticFile = function(uri) {

  /* function WebRequest.serveStaticFile
   * Servers static file to request
   */

  function getMIMEType(ext) {

    /* Function WebRequest.serveStaticFile::getMIMEType
     * Returns the HTTP MIME type associated with the file extension
     */

    const MIME_TYPE_JSON = {"Content-Type": "application/json"}
    const MIME_TYPE_ICON = {"Content-Type": "image/x-icon"}
    const MIME_TYPE_CSS = {"Content-Type": "text/css"}
    const MIME_TYPE_PNG = {"Content-Type": "image/png"}
    const MIME_TYPE_JS = {"Content-Type": "application/javascript"}
    const MIME_TYPE_TEXT = {"Content-Type": "plain/text"}

    switch(ext) {
      case ".json":
        return MIME_TYPE_JSON;
      case ".ico":
        return MIME_TYPE_ICON;
      case ".css":
        return MIME_TYPE_CSS;
      case ".png":
        return MIME_TYPE_PNG;
      case ".js":
        return MIME_TYPE_JS;
      default:
        return MIME_TYPE_TEXT;
    }

  }

  // Write the HTTP header [200] with the appropriate MIME type
  this.response.writeHead(OHTTP.S_HTTP_OK, getMIMEType(path.extname(uri)));

  return fs.createReadStream(path.join("static", uri)).pipe(this.response);

}

WebRequest.prototype.getSession = function(callback) {

  /* function WebRequest.getSession
   * Attemps to get an existing session from the database
   */

  callback = callback.bind(this);

  var sessionIdentifier = this.extractRequestCookie(this.request.headers);

  // No session cookie available
  if(sessionIdentifier === null) {
    return callback(null, null);
  }

  // Query the database
  Database.sessions().findOne({"SESSION_ID": sessionIdentifier}, function(error, session) {

    // Error querying the database
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // The session does not exist
    if(session === null) {
      return callback(null, null);
    }

    // Get the user that belongs to the session
    Database.users().findOne({"_id": session.userId}, function(error, user) {

      // Error querying the database
      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // No error but no user could be found
      if(user === null) {
        return callback(null, null);
      }

      var user = new User(user, sessionIdentifier);

      // Callback with a new authenticated user
      callback(null, user); 

    });

  }.bind(this));

}

WebRequest.prototype.handleSession = function(error, session) {

  /* Function WebRequest.handleSession
   * Callback fired when session is obtained
   */

  // Attach the session
  this.session = session;

  if(this.uri.startsWith("/login")) {

    // If the user is already logged in redirect to home page
    if(this.session !== null) {
      return this.redirect("/home");
    }
 
    return this.HTTPResponse(OHTTP.S_HTTP_OK, Template.generateLogin(this.request.url));

  }

  // The service is closed: do not allow log in
  if(CONFIG.__CLOSED__) {
    return this.HTTPError(OHTTP.E_HTTP_UNAVAILABLE);
  }

  switch(this.uri) {
    case "/authenticate":
      return this.launchAuthentication();
  }

  // Block any users with no session
  if(this.session === null) {
    return this.HTTPError(OHTTP.E_HTTP_UNAUTHORIZED);
  }

  // Forward the request to the API
  if(this.uri.startsWith("/api")) {
    return this.APIRequest();
  }

  // Looking for message details
  if(this.uri.startsWith("/home/messages/detail")) {
    return this.HTTPResponse(200, Template.generateMessageDetails(this.session));
  }
 
  // Serve different pages
  switch(this.uri) {
    case "/logout":
      return this.removeSession();
    case "/home":
      return this.launchHome();
    case "/send":
      return this.launchSend();
    case "/home/messages":
      return this.HTTPResponse(200, Template.generateMessages(this.session));
    case "/home/messages/new":
      return this.HTTPResponse(200, Template.generateNewMessageTemplate(this.request.url, this.session));
    case "/home/station":
      return this.HTTPResponse(200, Template.generateStationDetails(this.session));
    case "/upload":
      return this.launchUpload();
    case "/seedlink":
      return this.launchSeedlink();
  }

  // Not found!
  return this.HTTPError(OHTTP.E_HTTP_FILE_NOT_FOUND);

}

WebRequest.prototype.launchAuthentication = function() {

  /* Function WebRequest.launchAuthentication
   * Launches handler for user authentication
   */

  // Only implement the POST request
  if(this.request.method !== "POST") {
    return this.HTTPError(OHTTP.E_HTTP_NOT_IMPLEMENTED);
  }

  // Attempt to parse the POST body passed by the HTML form
  // Contains username and password
  this.parseRequestBody("json", this.handleParsedRequestBody);

}

WebRequest.prototype.launchUpload = function() {

  /* Function WebRequest.launchUpload
   * Launches handler for file uploading
   */

  // Only accept POST requests
  if(this.request.method !== "POST") {
    return this.HTTPError(OHTTP.E_HTTP_NOT_IMPLEMENTED);
  }

  // Block requests exceeding the configured limit (default 100MB)
  if(Number(this.request.headers["content-length"]) > CONFIG.MAXIMUM_POST_BYTES) {
    return this.HTTPError(OHTTP.E_HTTP_PAYLOAD_TOO_LARGE);
  }

  // Parse the POST body (binary file)
  this.parseRequestBody("multiform", function(files) {

    // Only accept files with content 
    var files = files.filter(function(x) {
      return x.data.length !== 0;
    });

    // Write (multiple) files to disk
    this.writeMultipleFiles(files, function(error) {

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      return this.redirect("/home?S_METADATA_SUCCESS");

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.launchSeedlink = function() {

  /* Function WebRequest.launchSeedlink
   * Launches Seedlink server submission code
   */

  const IPV4_ADDRESS_REGEX  = new RegExp("^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$");
  const HOSTNAME_REGEX = new RegExp("^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$");

  // Only accept POST requests
  if(this.request.method !== "POST") {
    return this.HTTPError(OHTTP.E_HTTP_NOT_IMPLEMENTED);
  }

  this.parseRequestBody("json", function(json) {

    // Confirm hostname or IPv4
    if(!IPV4_ADDRESS_REGEX.test(json.host) && !HOSTNAME_REGEX.test(json.host)) {
      return this.redirect("/home?E_SEEDLINK_HOST_INVALID");
    }

    var port = Number(json.port);

    // Accept ports between 0x0400 and 0xFFFF
    if(isNaN(port) || port < (1 << 10) || port > (1 << 16)) {
      return this.redirect("/home?E_SEEDLINK_PORT_INVALID");
    }

    // Store new seedlink object in database
    var storeObject = {
      "userId": this.session._id,
      "host": json.host,
      "port": port,
      "created": new Date()
    }

    // Only insert new seedlink servers
    Database.seedlink().find({"userId": this.session._id, "host": json.host, "port": port}).count(function(error, count) {

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // The server is already in the database
      if(count !== 0) {
        return this.redirect("/home?E_SEEDLINK_SERVER_EXISTS");
      }

      Database.seedlink().insertOne(storeObject, function(error, result) {

        if(error) {
          return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.redirect("/home?S_SEEDLINK_SERVER_SUCCESS");

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.launchHome = function() {

  /* WebRequest.launchHome
   * Launchs the EIDA Manager homepage
   */

  // Update the last visit & app. version
  if(this.search === "?welcome") {
    Database.users().updateOne({"_id": this.session._id}, {"$set": {"version": CONFIG.__VERSION__, "visited": new Date()}});
  }

  return this.HTTPResponse(OHTTP.S_HTTP_OK, Template.generateProfile(this.session));

}

WebRequest.prototype.launchSend = function() {

  /* WebRequest.launchHome
   * Launchs code to handle message submission
   */

  // Parse the POSTed request body as JSON
  this.parseRequestBody("json", function(postBody) {

    // Disallow message to be sent to self
    if(postBody.recipient === this.session.username) {
      return this.redirect("/home/messages/new?self");
    }

    // Admin may sign broadcasted message
    if(postBody.recipient === "broadcast" && this.session.role === "admin") {
      var userQuery = {"username": {"$not": {"$eq": this.session.username}}}
    } else if(postBody.recipient === "administrators") {
      var userQuery = {"role": "admin", "username": {"$not": {"$eq": this.session.username}}}
    } else {
      var userQuery = {"username": postBody.recipient}
    }

    // Query the user database for the recipient name
    Database.users().find(userQuery).toArray(function(error, users) {

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // Unknown recipient
      if(users.length === 0) {
        return this.redirect("/home/messages/new?unknown");
      }

      // Create a new message
      const messageBody = users.map(function(user) {
        return Message(
          user._id,
          this.session._id,
          escapeHTML(postBody.subject),
          escapeHTML(postBody.content)
        );
      }.bind(this));

      // Store all messages
      Database.messages().insertMany(messageBody, function(error, result) {

        // Error storing messages
        if(error) {
          return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.redirect("/home/messages/new?success");

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.removeSession = function() {

  /* WebRequest.removeSession
   * Removes a session from the database
   */

  Database.sessions().deleteOne({"SESSION_ID": this.session.sessionId}, function(error, result) {
  
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.redirect("/login?S_LOGGED_OUT");
    
  }.bind(this)); 

}

WebRequest.prototype.handleParsedRequestBody = function(postBody) {

  // Check the user credentials
  this.authenticate(postBody, this.handleAuthentication);

}

WebRequest.prototype.handleAuthentication = function(error, user) {

  // Authentication failed with invalid credentials
  if(error !== null) {
    return this.redirect("/login?" + error);
  }

  this.createSession(user, this.handleSessionCreation);

}

WebRequest.prototype.createSession = function(user, callback) {

  /* function createSession
   * Creates a new session
   */

  callback = callback.bind(this);

  // Create a new session for the user
  var session = new Session(user);

  // Metadata to store in the session collection
  var storeObject = {
    "SESSION_ID": session.id,
    "userId": user._id,
    "created": new Date()
  }

  // Insert a new session
  Database.sessions().insertOne(storeObject, function(error, result) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    callback(session);

  }.bind(this));

}

WebRequest.prototype.handleSessionCreation = function(session) {

  /* Function WebRequest.handleSessionCreation
   * Callback that handles creation of a new session
   */

  function cookie(session) {

    /* Function WebRequest.handleSessionCreation::cookie
     * Creates a new cookie string to send to client
     */

    return "SESSION_ID=" + session.id + "; Expires=" + session.expiration.toUTCString();

  }

  // Redirect user to home page and set a cookie for this session
  this.response.writeHead(OHTTP.S_HTTP_REDIRECT, {
    "Set-Cookie": cookie(session),
    "Location": "./home?welcome"
  });
 
  this.response.end();

}


WebRequest.prototype.authenticate = function(credentials, callback) {

  /* WebRequest.authenticate
   * Authenticates the users against credentials in the database
   */

  callback = callback.bind(this);

  Database.users().findOne({"username": credentials.username}, function(error, result) {

    // There was an error querying the database
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // The username is invalid
    if(result === null) {
      return callback("E_USERNAME_INVALID");
    }

    // The password is invalid 
    if(result.password !== SHA256(credentials.password + result.salt)) {
      return callback("E_PASSWORD_INVALID");
    }

    // Credentials are valid
    return callback(null, result);

  }.bind(this));

}

WebRequest.prototype.parseRequestBody = function(type, callback) {

  /* Function WebRequest.parseRequestBody
   * Parses a request body received from the client
   */

  function parseMultiform(buffer, headers) {
  
    /* Function WebRequest.parseRequestBody::parseMultiform
     * Parses multiform encoded data
     */
  
    return multipart.Parse(buffer, multipart.getBoundary(headers["content-type"]));
  
  }

  callback = callback.bind(this);

  var chunks = new Array();

  // Data received from client
  this.request.on("data", function(chunk) {

    chunks.push(chunk);

    // Limit the maximum number of bytes that can be posted
    if(sum(chunks) > CONFIG.MAXIMUM_POST_BYTES) {
      return this.HTTPError(OHTTP.E_HTTP_PAYLOAD_TOO_LARGE);
    }

  }.bind(this));

  // Request has been ended by client
  this.request.on("end", function() {

    // The request was aborted by the server
    if(this.response.finished) {
      return;
    }

    // Add all chunks to a string buffer
    var fullBuffer = Buffer.concat(chunks);

    // Support for different types of data
    switch(type) {
      case "multiform":
        return callback(parseMultiform(fullBuffer, this.request.headers));
      case "json":
        return callback(querystring.parse(fullBuffer.toString()));
      default:
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR)
    }

  }.bind(this));

}

WebRequest.prototype.redirect = function(path) {

  /* WebRequest.redirect
   * Redirects the client to another page
   */

  this.response.writeHead(OHTTP.S_HTTP_REDIRECT, {"Location": path});
  this.response.end();

}

WebRequest.prototype.HTTPResponse = function(statusCode, HTML) {

  /* Function WebRequest.HTTPResponse
   * Returns an HTTP error to the client
   */

  // Write the HTML response
  this.response.writeHead(statusCode, {"Content-Type": "text/html"});
  this.response.write(HTML);
  this.response.end();

}

WebRequest.prototype.HTTPError = function(statusCode, error) {

  /* Function WebRequest.HTTPError
   * Returns an HTTP error to the client
   */

  // Write the error to the log file
  if(error) {
    Console.error(error);
  }

  // Delegate to the generic HTTPResponse function
  return this.HTTPResponse(statusCode, Template.generateHTTPError(statusCode));

}

WebRequest.prototype.extractRequestCookie = function(headers) {

  /* Function WebRequest.extractRequestCookie
   * Extracts a session cookie from the HTTP headers
   */

  // Cookie not set in HTTP request headers
  if(headers.cookie === undefined) {
    return null;
  }

  var parsedQueryString;

  // Parse each cookie in the header field and attempt to get a cookie
  // named SESSION_ID
  var cookies = headers.cookie.split(";");

  for(var i = 0; i < cookies.length; i++) {

    parsedQueryString = querystring.parse(cookies[i].trim());

    // The session key was found: return the value
    if(Object.prototype.hasOwnProperty.call(parsedQueryString, "SESSION_ID")) {
      return parsedQueryString.SESSION_ID;
    }

  }

  return null;

}


var Webserver = function() {

  /* Class Webserver
   * Opens NodeJS webservice on given PORT
   * Handles all incoming connections
   */

  // Launch the metaDaemon
  if(CONFIG.METADATA.DAEMON.ENABLED) {
    require("./lib/orfeus-metadaemon");
  }

  // Create the HTTP server and listen to incoming requests
  var webserver = createServer(function(request, response) {
    new WebRequest(request, response);
  });

  // Listen to incoming connections
  webserver.listen(CONFIG.PORT, CONFIG.HOST, function() {
    Console.info("Webserver started at " + CONFIG.HOST + ":" + CONFIG.PORT);
  });

  // Graceful shutdown of server
  process.on("SIGINT", function () {
    Console.info("SIGINT received: closing webserver.");
    //webserver.close(function() {
      process.exit(0);
    //});
  });

}

WebRequest.prototype.writeMultipleFiles = function(files, callback) {

  /* Function WebRequest.writeMultipleFiles
   * Writes multiple (split) StationXML files to disk
   */

  function messageAdministrators(metadata, sessionId) {
  
    /* function messageAdministrators
     * Queries the database for all administrators
     */
  

    function getAdministrators(callback) {
    
      /* function getAdministrators
       * Returns documents for all administrators
       */
    
      Database.users().find({"role": "admin"}).toArray(function(error, administrators) {
    
        if(error) {
          return Console.error(error);
        }
    
        callback(administrators);
    
      });
    
    }

    // No files were uploaded
    if(metadata.length === 0) {
      return;
    }
  
    // Get all ORFEUS administrators
    getAdministrators(function(administrators) {
  
      // No administrators?
      if(administrators.length === 0) {
        return;
      }
  
      // Get a string of filenames submitted
      var filenames = metadata.map(function(file) {
        return escapeHTML(file.id);
      }).join(", ");

      // Message each administrator
      var messages = administrators.map(function(administrator) {
  
        // Skip message to self
        if(administrator._id.toString() === sessionId.toString()) {
          return;
        }
  
        return Message(
          administrator._id,
          sessionId,
          "Metadata Added",
          "New metadata has been submitted for station(s): " + filenames
        );

      });
  
      // Store messages
      Database.messages().insertMany(messages, function(error, result) {
  
        if(error) {
          return Console.error(error);
        }
  
        Console.info("Messaged " + administrators.length + " adminstrators about " + metadata.length + " file(s) uploaded.");
  
      });
  
    });
  
  }

  function saveFileObjects(metadata, sessionId) {
  
    /* function saveFileObjects
     * writes new file objects to the database
     */
    
    // Store file information in the database
    var files = metadata.map(function(x) {
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
        "userId": sessionId,
        "created": new Date(),
        "sha256": x.sha256
      }
    });
  
    // Asynchronously store all file objects
    Database.files().insertMany(files, function(error) {

      if(error) {
        return files.forEach(function(x) {
          Console.error(new Error("Could not add file object " + x.filename + " to the database."));
        });
      }

      Console.info("Stored " + files.length + " new file objects in the database.");

    });
  
  }

  var XMLDocuments;

  // We split any submitted StationXML files
  try {
    XMLDocuments = splitStationXML(files);
  } catch(exception) {
    return callback(exception);
  }

  // Confirm user is manager of the network
  for(var i = 0; i < XMLDocuments.length; i++) {
    if(this.session.role !== "admin" && this.session.network !== XMLDocuments[i].metadata.network) {
      return callback(new Error("User is not owner of network.")); 
    }
  }

  // Create a copy of all metadata
  var XMLMetadata = XMLDocuments.map(function(x) {
    return x.metadata;
  });

  // Create directories
  XMLMetadata.forEach(function(x) {
    createDirectory(x.filepath);
  });

  // Write a message to the administrators
  messageAdministrators(XMLMetadata, this.session._id);

  // Write file metadata to the database
  saveFileObjects(XMLMetadata, this.session._id);

  if(XMLDocuments.length === 0) {
    return callback(null);
  }

  var writeFile;

  // Asynchronous writing for multiple files to disk
  (writeFile = function() {

    var file = XMLDocuments.pop();

    var STATUS_MESSAGE = "Writing file " + file.metadata.sha256 + " (" + file.metadata.id + ") to disk";

    // NodeJS std lib for writing file
    fs.writeFile(path.join(file.metadata.filepath, file.metadata.sha256 + ".stationXML"), file.data, function(error) {

      // Write to log
      error ? Console.error(error) : Console.info(STATUS_MESSAGE);

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

WebRequest.prototype.APIRequest = function() {

  /* Fuction APIRequest
   * All requests to the ORFEUS API go through here
   */

  var search = this.search ? this.search.split("&").shift() : null;

  // Register new routes here
  switch(this.uri) {
    case "/api/seedlink":
      return this.getSeedlinkServers();
    case "/api/latency":
      return this.getStationLatencies();
    case "/api/stations":
      return this.getFDSNWSStations();
    case "/api/staged":
      return this.getSubmittedFiles();
    case "/api/channels":
      return this.getFDSNWSChannels();
    case "/api/messages":
      switch(this.request.method) {
        case "GET":
          switch(search) {
            case "?new":
              return this.getNewMessages();
            default:
              return this.getMessages();
          }
        case "DELETE":
          switch(search) {
            case "?deleteall":
              return this.removeAllMessages();
            case "?deletesent":
              return this.removeAllMessagesSent();
          }
 
      }
    case "/api/messages/details":
      switch(this.request.method) {
        case "GET":
          return this.getSpecificMessage();
        case "DELETE":
          return this.removeSpecificMessage();
        default:
          return this.HTTPError(OHTTP.E_HTTP_NOT_IMPLEMENTED);
      }
    default:
      return this.HTTPError(OHTTP.E_HTTP_FILE_NOT_FOUND);

  }

}

WebRequest.prototype.getSeedlinkServers = function() {

  /* function getSeedlinkServers
   * Returns submitted seedlink servers from the database
   */

  Database.seedlink().find({"userId": this.session._id}).toArray(function(error, results) {

    // There was an error or no results: show nothing
    if(error || results.length === 0) {
      return new Array();
    }

    // Extact all the hostnames
    var servers = results.map(function(x) {
      return x.host;
    })

    // Combine all servers and ports
    var serversAndPorts = results.map(function(x) {
      return x.host + ":" + x.port;
    }).join(",");

    // Query the DNS records
    OHTTP.getDNS(servers, function(DNSRecords) {

      // Create a temporary hashmap for easy look up
      var hashMap = new Object();
      DNSRecords.forEach(function(x) {
        hashMap[x.host] = x.ip;
      });

      // Make the request to the internal API
      OHTTP.request("http://" + CONFIG.STATIONS.HOST + ":" + CONFIG.STATIONS.PORT + "?host=" + serversAndPorts, function(data) { 

        if(!data) {
          return this.writeJSON(results);
        }

        data = JSON.parse(data);

        // Collect all the results
        results.forEach(function(x) {

          for(var i = 0; i < data.length; i++) {

            if(data[i].server.url === x.host + ":" + x.port) {

              x.ip = hashMap[x.host] || "Unknown";
              x.identifier = data[i].identifier;
              x.connected = data[i].connected;
              x.version = data[i].version;

              if(data[i].stations === null) {
                x.stations = "Not Available";
              } else {
                x.stations = data[i].stations.filter(function(station) {
                  return station.network === this.session.network;
                }.bind(this));
              }

            }
          } 

        }.bind(this));

        this.writeJSON(results);

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.removeAllMessagesSent = function() {

  /* Function WebRequest.RemoveAllMessages
   * Sets all messages for user to deleted
   */

  var query = {
    "sender": Database.ObjectId(this.session._id),
    "senderDeleted": false
  }

  // Get specific message from the database
  Database.messages().updateMany(query, {"$set": {"senderDeleted": true}}, function(error, messages) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    writeJSON(messages);

  });

}

WebRequest.prototype.RemoveAllMessages = function() {

  /* Function WebRequest.RemoveAllMessages
   * Sets all messages for user to deleted
   */

  var query = {
    "recipient": Database.ObjectId(this.session._id),
    "recipientDeleted": false
  }

  // Get specific message from the database
  Database.messages().updateMany(query, {"$set": {"recipientDeleted": true}}, function(error, messages) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(messages);

  });

}

WebRequest.prototype.removeSpecificMessage = function() {

  /* Function WebRequest.RemoveSpecificMessage
   * Sets message with particular id to deleted
   */

  // Get the message identifier from the query string
  var qs = querystring.parse(url.parse(this.request.url).query);

  var senderQuery = {
    "sender": Database.ObjectId(this.session._id),
    "senderDeleted": false,
    "_id": Database.ObjectId(qs.id)
  }

  var recipientQuery = {
    "recipient": Database.ObjectId(this.session._id),
    "recipientDeleted": false,
    "_id": Database.ObjectId(qs.id)
  }

  // Get specific message from the database
  Database.messages().updateOne(recipientQuery, {"$set": {"recipientDeleted": true}}, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(message.result.nModified === 0) {

      Database.messages().updateOne(senderQuery, {"$set": {"senderDeleted": true}}, function(error, message) {

        // Could not find message
        if(error) {
          return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.writeJSON({"status": "deleted"});

      }.bind(this));

    }

    this.writeJSON({"status": "deleted"});

  }.bind(this));

}

WebRequest.prototype.getSpecificMessage = function() {

  /* Function GetSpecificMessage
   * Returns a specific private message
   */

  var qs = querystring.parse(url.parse(this.request.url).query);

  // Get messages as sender or recipient (undeleted)
  var query = {
    "_id": Database.ObjectId(qs.id),
    "$or": [{
      "recipient": Database.ObjectId(this.session._id),
      "recipientDeleted": false
    }, {
      "sender": Database.ObjectId(this.session._id),
      "senderDeleted": false
    }]
  }

  // Get specific message from the database
  Database.messages().findOne(query, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // Check if the author of the message is the owner of the session
    var author = message.sender.toString() === this.session._id.toString();

    // If requestee is not the author: set message to read
    if(!author) {
      Database.messages().updateOne(query, {"$set": {"read": true}});
    }

    // Find the username for the message sender 
    Database.users().findOne({"_id": Database.ObjectId(author ? message.recipient : message.sender)}, function(error, user) {

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

      this.writeJSON(messageContent);

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.getNewMessages = function() {

  /* Function GetNewMessages
   * Return the number of new messages 
   */

  var query = {
    "recipient": Database.ObjectId(this.session._id),
    "read": false,
    "recipientDeleted": false
  }

  Database.messages().find(query).count(function(error, count) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON({"count": count});

  }.bind(this));

}

WebRequest.prototype.getMessages = function() {

  /* Function WebRequest.getMessages
   * Returns all messages that belong to a user in a session
   */

  const query = {
    "$or": [{
      "recipient": Database.ObjectId(this.session._id),
      "recipientDeleted": false
    }, {
      "sender": Database.ObjectId(this.session._id),
      "senderDeleted": false
    }]
  }

  // Query the database for all messages
  Database.messages().find(query).sort({"created": -1}).toArray(function(error, documents) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
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
          "author": x.sender.toString() === this.session._id.toString()
        }
      }.bind(this));
      
      this.writeJSON(messageContents);

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.getStationLatencies = function() {

  /* Function WebRequest.getStationLatencies
   * Returns Seedlink latencies for a network, station
   */

  OHTTP.request("http://" + CONFIG.LATENCY.HOST + ":" + CONFIG.LATENCY.PORT + this.search, function(json) {
    this.writeJSON(JSON.parse(json));
  }.bind(this));

}

WebRequest.prototype.writeJSON = function(json) {

  /* Function WebRequest.writeJSON
   * Writes JSON to client
   */

  if(json === null) {
    return this.HTTPError(204);
  }

  // This is bound to the response
  this.response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "application/json"});
  this.response.write(JSON.stringify(json));
  this.response.end();

}


WebRequest.prototype.getFDSNWSChannels = function() {

  /* Function WebRequest.getFDSNWSChannels
   * Returns the channels for a given station from FDSNWS
   */

  var queryString = querystring.stringify({
    "level": "channel",
    "format": "text",
  });

  // Extend the query string
  queryString += "&" + url.parse(this.request.url).query;

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    this.writeJSON(this.parseFDSNWSResponse(json));
  }.bind(this));

}

WebRequest.prototype.parseFDSNWSResponse = function(data) {

  /* Function WebRequest.ParseFDSNWSResponse
   * Returns parsed JSON response from FDSNWS Station Webservice
   * for varying levels of information
   */

  // Return an empty array
  if(data === null) {
    return null;
  }

  var codes;

  // Run through the response and convert to JSON
  return data.split("\n").slice(1, -1).map(function(line) {

    codes = line.split("|");

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

WebRequest.prototype.getSubmittedFiles = function() {

  /* function WebRequest.getSubmittedFiles
   * Abstracted function to read files from multiple directories
   * and concatenate the result
   */

  // Stages:
  // Pending -> Accepted | Rejected
  var pipeline = [{
    "$match": {
      "userId": Database.ObjectId(this.session._id),
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
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(files);

  }.bind(this));

}

WebRequest.prototype.getFDSNWSStations = function() {

  /* Function GetFDSNWSStations
   * Returns station information from FDSNWS Station
   */

  var queryString = querystring.stringify({
    "level": "station",
    "format": "text",
    "network": this.session.network
  })

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    this.writeJSON(this.parseFDSNWSResponse(json));
  }.bind(this));

}

Init();

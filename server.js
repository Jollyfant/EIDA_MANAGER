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
const database = require("./lib/orfeus-database");
const { User, Session } = require("./lib/orfeus-session");
const logger = require("./lib/orfeus-logging");
const { SHA256 } = require("./lib/orfeus-crypto");
const OHTTP = require("./lib/orfeus-http");
const template = require("./lib/orfeus-template");
const { sum, createDirectory, escapeHTML } = require("./lib/orfeus-util");
const { splitStationXML } = require("./lib/orfeus-metadata.js");

// Static information
const CONFIG = require("./config");
const STATIC_FILES = require("./lib/orfeus-static");

function init() {

  /* function init
   * Initializes the application
   */

  // Attempt to connect to the database
  database.connect(function(error) {
  
    // Could not connect to Mongo: retry in 5 seconds
    if(error) {
      logger.fatal(error);
      return setTimeout(init, 5000);
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

  this.url = url.parse(request.url);

  this.init();

}

WebRequest.prototype.logHTTPRequest = function() {

  /* Function WebRequest.logHTTPRequest
   * Writes HTTP summary to access log
   */

  function getClientIP(request) {

    /* Function WebRequest.logHTTPRequest::getClientIP
     * Returns the client IP address
     */

    return request.headers["x-forwarded-for"] || request.connection.remoteAddress || null;

  }

  function getUserAgent(request) {

    /* Function WebRequest.logHTTPRequest::getUserAgent
     * Returns the client user agent
     */

    return request.headers["user-agent"] || null;

  }

  // Extract the clientIP and User Agent
  const clientIP = getClientIP(this.request);
  const userAgent = getUserAgent(this.request);

  // Mimic HTTPD access log 
  logger.access([
    clientIP,
    this.url.pathname,
    this.request.method,
    this.response.statusCode,
    this.response.bytesWritten,
    userAgent
  ].join(" "));

}

WebRequest.prototype.patchResponse = function() {

  /* Function WebRequest.patchResponse
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

  // The service is closed: do not allow log in
  if(CONFIG.__CLOSED__) {
    return this.HTTPError(OHTTP.E_HTTP_UNAVAILABLE);
  }

  // Static files are always served
  if(STATIC_FILES.includes(this.url.pathname)) {
    return this.serveStaticFile(this.url.pathname);
  }

  // Attempt to get a running session
  this.getSession(this.handleSession);

}


WebRequest.prototype.serveStaticFile = function(resource) {

  /* Function WebRequest.serveStaticFile
   * Servers static file to request
   */

  function getMIMEType(ext) {

    /* Function WebRequest.serveStaticFile::getMIMEType
     * Returns the HTTP MIME type associated with the file extension
     */

    switch(ext) {
      case ".json":
        return OHTTP.MIME.JSON;
      case ".ico":
        return OHTTP.MIME.ICON;
      case ".css":
        return OHTTP.MIME.CSS;
      case ".png":
        return OHTTP.MIME.PNG;
      case ".js":
        return OHTTP.MIME.JS;
      default:
        return OHTTP.MIME.TEXT;
    }

  }

  // Write the HTTP header [200] with the appropriate MIME type
  this.response.writeHead(OHTTP.S_HTTP_OK, getMIMEType(path.extname(resource)));

  return fs.createReadStream(path.join("static", resource)).pipe(this.response);

}

WebRequest.prototype.getSession = function(callback) {

  /* function WebRequest.getSession
   * Attemps to get an existing session from the database
   */

  function extractSessionCookie(headers) {
  
    /* Function WebRequest.extractSessionCookie
     * Extracts a session cookie from the HTTP headers
     */
  
    // Cookie not set in HTTP request headers
    if(headers.cookie === undefined) {
      return null;
    }
  
    // Parse each cookie in the header field and attempt to get a cookie
    // named EIDA-MANAGER-ID
    var cookies = headers.cookie.split(";");
    var parsedQueryString;
  
    for(var i = 0; i < cookies.length; i++) {
  
      parsedQueryString = querystring.parse(cookies[i].trim());
  
      // The session key was found: return the value
      if(Object.prototype.hasOwnProperty.call(parsedQueryString, "EIDA-MANAGER-ID")) {
        return parsedQueryString["EIDA-MANAGER-ID"];
      }
  
    }
  
    return null;
  
  }

  callback = callback.bind(this);

  // Get the session identifier from cookie
  var sessionIdentifier = extractSessionCookie(this.request.headers);

  // No session cookie available
  if(sessionIdentifier === null) {
    return callback(null);
  }

  // Query the database
  database.sessions().findOne({"EIDA-MANAGER-ID": sessionIdentifier}, function(error, session) {

    // Error querying the database
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // The session does not exist
    if(session === null) {
      return callback(null);
    }

    // Get the user that belongs to the session
    database.users().findOne({"_id": session.userId}, function(error, user) {

      // Error querying the database
      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // No error but no user could be found
      if(user === null) {
        return callback(null);
      }

      // Callback with the authenticated user
      callback(new User(user, sessionIdentifier)); 

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.handleSession = function(session) {

  /* Function WebRequest.handleSession
   * Callback fired when session is obtained
   */

  // Session is not required
  switch(this.url.pathname) {
    case "/":
      return this.redirect("/login");
    case "/login":
      return this.launchLogin();
    case "/authenticate":
      return this.launchAuthentication();
  }

  // No running session means unauthorized
  if(session === null) {
    return this.HTTPError(OHTTP.E_HTTP_UNAUTHORIZED);
  }

  // Attach the session
  this.session = session;

  // Forward the request to the API
  if(this.url.pathname.startsWith("/api")) {
    return this.APIRequest();
  }

  // Serve the different pages
  switch(this.url.pathname) {
    case "/logout":
      return this.removeSession();
    case "/home":
      return this.launchHome();
    case "/send":
      return this.launchSend();
    case "/upload":
      return this.launchUpload();
    case "/seedlink":
      return this.launchSeedlink();
    case "/home/messages":
      return this.HTTPResponse(200, template.generateMessages(this.session));
    case "/home/messages/details":
      return this.HTTPResponse(200, template.generateMessageDetails(this.session));
    case "/home/messages/new":
      return this.HTTPResponse(200, template.generateNewMessagetemplate(this.request.url, this.session));
    case "/home/station":
      return this.HTTPResponse(200, template.generateStationDetails(this.session));
    default:
      return this.HTTPError(OHTTP.E_HTTP_FILE_NOT_FOUND);
  }

}

WebRequest.prototype.launchLogin = function() {

  /* Function WebRequest.launchLogin
   * Launches login page if not signed in
   */

  // If the user is already logged in redirect to home page
  if(this.session !== null) {
    return this.redirect("/home");
  }

  return this.HTTPResponse(OHTTP.S_HTTP_OK, template.generateLogin(this.request.url));

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
  this.parseRequestBody("json", this.handleAuthenticationPOST);

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
    var files = files.filter(x => x.data.length !== 0);

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
    database.seedlink().find({"userId": this.session._id, "host": json.host, "port": port}).count(function(error, count) {

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // The server is already in the database
      if(count !== 0) {
        return this.redirect("/home?E_SEEDLINK_SERVER_EXISTS");
      }

      database.seedlink().insertOne(storeObject, function(error, result) {

        if(error) {
          return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.redirect("/home?S_SEEDLINK_SERVER_SUCCESS");

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.launchHome = function() {

  /* Function WebRequest.launchHome
   * Launchs the EIDA Manager homepage
   */

  // Update the last visit & app. version
  if(this.url.search === "?welcome") {
    database.users().updateOne({"_id": this.session._id}, {"$set": {"version": CONFIG.__VERSION__, "visited": new Date()}});
  }

  return this.HTTPResponse(OHTTP.S_HTTP_OK, template.generateProfile(this.session));

}

WebRequest.prototype.launchSend = function() {

  /* Function WebRequest.launchSend
   * Launchs code to handle message submission
   */

  function getRecipientQuery(session, recipient) {

    /* Function WebRequest.launchSend::getRecipientQuery
     * Returns query to find the recipieint
     */

    if(session.role === "admin" && recipient === "broadcast") {
      return {"username": {"$not": {"$eq": session.username}}}
    }

    if(recipient === "administrators") {
      return {"role": "admin", "username": {"$not": {"$eq": session.username}}}
    }

    return {"username": recipient}

  }

  // Parse the POSTed request body as JSON
  this.parseRequestBody("json", function(postBody) {

    // Disallow message to be sent to self
    if(postBody.recipient === this.session.username) {
      return this.redirect("/home/messages/new?self");
    }

    var userQuery = getRecipientQuery(this.session, postBody.recipient);

    // Query the user database for the recipient name
    database.users().find(userQuery).toArray(function(error, users) {

      if(error) {
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // Unknown recipient
      if(users.length === 0) {
        return this.redirect("/home/messages/new?unknown");
      }

      // Create a new message for each user
      const messageBody = users.map(function(user) {
        return Message(
          user._id,
          this.session._id,
          escapeHTML(postBody.subject),
          escapeHTML(postBody.content)
        );
      }.bind(this));

      // Store all messages
      database.messages().insertMany(messageBody, function(error, result) {

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

  /* Function WebRequest.removeSession
   * Removes a session from the database collection
   */

  logger.debug("Removing session for user " + this.session.username + " with session identifier " + this.session.sessionId);

  database.sessions().deleteOne({"EIDA-MANAGER-ID": this.session.sessionId}, function(error, result) {
  
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.redirect("/login?S_LOGGED_OUT");
    
  }.bind(this)); 

}

WebRequest.prototype.handleAuthenticationPOST = function(credentials) {

  /* Function WebRequest.handleParsedRequestPOST
   * Code that handles when credentials were posted to the /authenticate endpoint
   */

  // Check the user credentials
  this.authenticate(credentials, this.handleAuthentication);

}

WebRequest.prototype.handleAuthentication = function(error, user) {

  /* Function WebRequest.handleAuthentication
   * Blocks requests with false credentials
   */

  // Authentication failed with invalid credentials
  if(error !== null) {
    return this.redirect("/login?" + error);
  }

  this.createSession(user, this.handleSessionCreation);

}

WebRequest.prototype.createSession = function(user, callback) {

  /* function WebRequest.createSession
   * Creates a new session in the database
   */

  callback = callback.bind(this);

  // Create a new session for the user
  var session = new Session(user);

  // Metadata to store in the session collection
  var storeObject = {
    "EIDA-MANAGER-ID": session.id,
    "userId": user._id,
    "created": new Date()
  }

  // Insert a new session
  database.sessions().insertOne(storeObject, function(error, result) {

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

    return "EIDA-MANAGER-ID=" + session.id + "; Expires=" + session.expiration.toUTCString();

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

  database.users().findOne({"username": credentials.username}, function(error, result) {

    // There was an error querying the database
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // The username is invalid
    if(result === null) {
      return callback("E_USERNAME_INVALID", null);
    }

    // The password is invalid 
    if(result.password !== SHA256(credentials.password + result.salt)) {
      return callback("E_PASSWORD_INVALID", null);
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
        return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR);
    }

  }.bind(this));

}

WebRequest.prototype.redirect = function(path) {

  /* Function WebRequest.redirect
   * Redirects the client to another page
   */

  this.response.writeHead(OHTTP.S_HTTP_REDIRECT, {"Location": path});
  this.response.end();

}

WebRequest.prototype.HTTPResponse = function(statusCode, HTML) {

  /* Function WebRequest.HTTPResponse
   * Returns an HTTP error to the client
   */

  // Handle 204
  if(statusCode === OHTTP.S_HTTP_NO_CONTENT) {
    this.response.writeHead(statusCode);
    this.response.end();
    return;
  }

  // Write the HTML response
  this.response.writeHead(statusCode, OHTTP.MIME.HTML);
  this.response.write(HTML);
  this.response.end();

}

WebRequest.prototype.HTTPError = function(statusCode, error) {

  /* Function WebRequest.HTTPError
   * Returns an HTTP error to the client
   */

  // Write the error to the log file
  if(error) {
    logger.error(error);
  }

  // Delegate to the generic HTTPResponse function
  return this.HTTPResponse(statusCode, template.generateHTTPError(statusCode));

}

var Webserver = function() {

  /* Class Webserver
   * Opens NodeJS webservice on given PORT
   * Handles all incoming connections
   */

  // Launch the metaDaemon if enabled
  if(CONFIG.METADATA.DAEMON.ENABLED) {
    require("./lib/orfeus-metadaemon");
  }

  // Create the HTTP server and listen to incoming requests
  this.webserver = createServer(function(request, response) {
    new WebRequest(request, response);
  });

  // Listen to incoming connections
  this.webserver.listen(CONFIG.PORT, CONFIG.HOST, function() {
    logger.info("Webserver started at " + CONFIG.HOST + ":" + CONFIG.PORT);
  });

  // Graceful shutdown of server
  process.on("SIGINT", this.SIGINT.bind(this));

}

Webserver.prototype.SIGINT = function() {

  /* Function Webserver.SIGINT
   * Signal handler for SIGINT
   */

  logger.info("SIGINT received - initializing graceful shutdown of webserver.");

  this.webserver.close(function() {
    logger.info("Webserver was closed."); process.exit(0);
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
    
      database.users().find({"role": "admin"}).toArray(function(error, administrators) {
    
        if(error) {
          return logger.error(error);
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
      var filenames = metadata.map(x => escapeHTML(x.id)).join(", ");

      // Message each administrator
      // Skip message to self
      var messages = administrators.filter(x => x._id.toString() !== sessionId.toString()).map(function(administrator) {
  
        return Message(
          administrator._id,
          sessionId,
          "Metadata Added",
          "New metadata has been submitted for station(s): " + filenames
        );

      });
  
      // Store messages
      database.messages().insertMany(messages, function(error, result) {
  
        if(error) {
          return logger.error(error);
        }
  
        logger.info("Messaged " + administrators.length + " adminstrators about " + metadata.length + " file(s) uploaded.");
  
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
        "status": database.METADATA_STATUS_PENDING,
        "userId": sessionId,
        "created": new Date(),
        "sha256": x.sha256
      }
    });
  
    // Asynchronously store all file objects
    database.files().insertMany(files, function(error) {

      if(error) {
        return files.forEach(function(x) {
          logger.error(new Error("Could not add file object " + x.filename + " to the database."));
        });
      }

      logger.info("Stored " + files.length + " new file objects in the database.");

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
      return callback(new Error("User does not own network rights.")); 
    }
  }

  // Create a copy of all metadata
  var XMLMetadata = XMLDocuments.map(x => x.metadata);

  // Create directories
  XMLMetadata.forEach(x => createDirectory(x.filepath));

  // Write a message to the administrators
  messageAdministrators(XMLMetadata, this.session._id);

  // Write file metadata to the database
  saveFileObjects(XMLMetadata, this.session._id);

  if(XMLDocuments.length === 0) {
    return callback(new Error("No metadata was submitted."));
  }

  var writeFile;

  // Asynchronous writing for multiple files to disk
  (writeFile = function() {

    var file = XMLDocuments.pop();
    var STATUS_MESSAGE = "Writing file " + file.metadata.sha256 + " (" + file.metadata.id + ") to disk";

    // NodeJS std lib for writing file
    fs.writeFile(path.join(file.metadata.filepath, file.metadata.sha256 + ".stationXML"), file.data, function(error) {

      // Write to log
      error ? logger.error(error) : logger.info(STATUS_MESSAGE);

      if(error) {
        return callback(error);
      }

      // Done writing files
      if(XMLDocuments.length === 0) {
        return callback(null)
      }

      // More files to write
      writeFile();
      
    });

  })();

}

function Message(recipient, sender, subject, content) {

  /* Function Message
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

  /* Fuction WebRequest.APIRequest
   * All requests to the ORFEUS API go through here
   */

  // Only get the first query parameter (jQuery may add another one to prevent caching)
  var search = this.url.search ? this.url.search.split("&").shift() : null;

  // Register new routes here
  switch(this.url.pathname) {
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

  /* Function WebRequest.getSeedlinkServers
   * Returns submitted seedlink servers from the database
   */

  database.seedlink().find({"userId": this.session._id}).toArray(function(error, results) {

    // There was an error or no results: show nothing
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // No servers found in the database
    if(results.length === 0) {
      return this.HTTPResponse(OHTTP.S_HTTP_NO_CONTENT);
    }

    // Extact all the hostnames
    var servers = results.map(x => x.host);

    // Combine all servers and ports
    var serversAndPorts = results.map(x => x.host + ":" + x.port);

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
                x.stations = data[i].stations.filter(station => station.network === this.session.network);
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
    "sender": database.ObjectId(this.session._id),
    "senderDeleted": false
  }

  // Get specific message from the database
  database.messages().updateMany(query, {"$set": {"senderDeleted": true}}, function(error, messages) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(messages);

  }.bind(this));

}

WebRequest.prototype.RemoveAllMessages = function() {

  /* Function WebRequest.RemoveAllMessages
   * Sets all messages for user to deleted
   */

  var query = {
    "recipient": database.ObjectId(this.session._id),
    "recipientDeleted": false
  }

  // Get specific message from the database
  database.messages().updateMany(query, {"$set": {"recipientDeleted": true}}, function(error, messages) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(messages);

  }.bind(this));

}

WebRequest.prototype.removeSpecificMessage = function() {

  /* Function WebRequest.RemoveSpecificMessage
   * Sets message with particular id to deleted
   */

  // Get the message identifier from the query string
  var queryString = querystring.parse(this.url.query);

  var senderQuery = {
    "sender": database.ObjectId(this.session._id),
    "senderDeleted": false,
    "_id": database.ObjectId(queryString.id)
  }

  var recipientQuery = {
    "recipient": database.ObjectId(this.session._id),
    "recipientDeleted": false,
    "_id": database.ObjectId(queryString.id)
  }

  // Get specific message from the database
  database.messages().updateOne(recipientQuery, {"$set": {"recipientDeleted": true}}, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(message.result.nModified === 0) {

      database.messages().updateOne(senderQuery, {"$set": {"senderDeleted": true}}, function(error, message) {

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

  var queryString = querystring.parse(this.url.query);

  // Get messages as sender or recipient (undeleted)
  var query = {
    "_id": database.ObjectId(queryString.id),
    "$or": [{
      "recipient": database.ObjectId(this.session._id),
      "recipientDeleted": false
    }, {
      "sender": database.ObjectId(this.session._id),
      "senderDeleted": false
    }]
  }

  // Get specific message from the database
  database.messages().findOne(query, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // Check if the author of the message is the owner of the session
    var author = message.sender.toString() === this.session._id.toString();

    // If requestee is not the author: set message to read
    if(!author) {
      database.messages().updateOne(query, {"$set": {"read": true}});
    }

    // Find the username for the message sender 
    database.users().findOne({"_id": database.ObjectId(author ? message.recipient : message.sender)}, function(error, user) {

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

  /* Function WebRequest.getNewMessages
   * Return the number of new messages 
   */

  var query = {
    "recipient": database.ObjectId(this.session._id),
    "read": false,
    "recipientDeleted": false
  }

  database.messages().find(query).count(function(error, count) {

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

  const DESCENDING = -1;

  const query = {
    "$or": [{
      "recipient": database.ObjectId(this.session._id),
      "recipientDeleted": false
    }, {
      "sender": database.ObjectId(this.session._id),
      "senderDeleted": false
    }]
  }

  // Query the database for all messages
  database.messages().find(query).sort({"created": DESCENDING}).toArray(function(error, documents) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // Get all messages where the user is either the sender or recipient
    const userQuery = {
      "_id": {
        "$in": documents.map(x => database.ObjectId(x.sender)).concat(documents.map(x => database.ObjectId(x.recipient)))
      }
    }

    // Get usernames from user identifiers
    database.users().find(userQuery).toArray(function(error, users) {

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

  OHTTP.request("http://" + CONFIG.LATENCY.HOST + ":" + CONFIG.LATENCY.PORT + this.url.search, function(json) {
    this.writeJSON(JSON.parse(json));
  }.bind(this));

}

WebRequest.prototype.writeJSON = function(json) {

  /* Function WebRequest.writeJSON
   * Writes JSON to client
   */

  // Null when 204
  if(json === null) {
    return this.HTTPResponse(OHTTP.S_HTTP_NO_CONTENT);
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
  queryString += "&" + this.url.query;

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    this.writeJSON(this.parseFDSNWSResponse(json));
  }.bind(this));

}

WebRequest.prototype.parseFDSNWSResponse = function(data) {

  /* Function WebRequest.ParseFDSNWSResponse
   * Returns parsed JSON response from FDSNWS Station Webservice
   * for varying levels of information
   */

  function stationObject(codes) {

    /* Function WebRequest.ParseFDSNWSResponse::stationObject
     * Returns a station object from | delimited parameters
     */

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

  }

  function channelObject(codes) {

    /* Function WebRequest.ParseFDSNWSResponse::channelObject
     * Returns a channel object from | delimited parameters
     */

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
        return stationObject(codes);
      case 17:
        return channelObject(codes);
    }

  });

}

WebRequest.prototype.getSubmittedFiles = function() {

  /* Function WebRequest.getSubmittedFiles
   * Abstracted function to read files from multiple directories
   * and concatenate the result
   */

  // Stages:
  // Pending -> Accepted | Rejected
  var pipeline = [{
    "$match": {
      "userId": database.ObjectId(this.session._id),
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
          database.METADATA_STATUS_REJECTED,
          database.METADATA_STATUS_PENDING,
          database.METADATA_STATUS_CONVERTED,
          database.METADATA_STATUS_VALIDATED,
          database.METADATA_STATUS_ACCEPTED
        ]
      }
    }
  }];

  // Query the database for submitted files
  database.files().aggregate(pipeline).toArray(function(error, files) {

    if(error) {
      return this.HTTPError(OHTTP.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(files);

  }.bind(this));

}

WebRequest.prototype.getFDSNWSStations = function() {

  /* Function WebRequest.GetFDSNWSStations
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

// Init the server
init();

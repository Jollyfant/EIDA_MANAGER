/* 
 * EIDA Manager
 * index.js
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
const fs = require("fs");
const { createServer } = require("http");
const path = require("path");
const querystring = require("querystring");
const url = require("url");

// ORFEUS libs
const { SHA256 } = require("./lib/orfeus-crypto");
const { sum, createDirectory } = require("./lib/orfeus-util");
const { updateStationXML, parsePrototype, splitStationXML } = require("./lib/orfeus-metadata.js");
const { Message } = require("./lib/orfeus-message");
const database = require("./lib/orfeus-database");
const logger = require("./lib/orfeus-logging");
const ohttp = require("./lib/orfeus-http");
const template = require("./lib/orfeus-template");
const seisComP3 = require("./lib/orfeus-seiscomp");

// Static information
const CONFIG = require("./config");

function __init__() {

  /*
   * Function __init__
   * Initializes the application
   */

  // Attempt to connect to the database
  database.connect(function(error) {
  
    // Could not connect to Mongo: retry in 1 second
    if(error) {
      setTimeout(__init__, 1000);
      return logger.fatal(error);
    }
  
    // Create a new webserver
    new Webserver();
  
  });

}

var WebRequest = function(request, response) {

  /*
   * Class WebRequest
   * Handles a single request to the HTTP webserver
   */

  this.request = request;
  this.response = response;
  this.session = null;

  // Save the parsed url
  this.url = url.parse(request.url);
  this.query = querystring.parse(this.url.query);

}

WebRequest.prototype.logHTTPRequest = function() {

  /*
   * Function WebRequest.logHTTPRequest
   * Writes HTTP summary to access log
   */

  function getClientIP(request) {

    /*
     * Function WebRequest.logHTTPRequest::getClientIP
     * Returns the client IP address
     */

    return request.headers["x-forwarded-for"] || request.connection.remoteAddress || null;

  }

  function getUserAgent(request) {

    /*
     * Function WebRequest.logHTTPRequest::getUserAgent
     * Returns the client user agent
     */

    return request.headers["user-agent"] || null;

  }

  // Extract the clientIP and User Agent
  var clientIP = getClientIP(this.request);
  var userAgent = getUserAgent(this.request);

  // Mimic HTTPD access log 
  logger.access([
    clientIP,
    this.url.pathname,
    this.request.method,
    this.response.statusCode,
    this.response.bytesWritten,
    "\"" + userAgent + "\""
  ].join(" "));

}

WebRequest.prototype.patchResponse = function() {

  /*
   * Function WebRequest.patchResponse
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

  /*
   * Function WebRequest.init
   * Initializes an instance of the WebRequest class
   */

  // Lazy load static files
  const STATIC_FILES = require("./lib/orfeus-static");

  this._initialized = Date.now();

  // Patch the response object
  this.patchResponse();

  // The service is closed: do not allow log in
  if(CONFIG.__CLOSED__) {
    return this.HTTPError(ohttp.E_HTTP_UNAVAILABLE);
  }

  // Static files are always served by the webserver
  if(STATIC_FILES.includes(this.url.pathname)) {
    return this.serveStaticFile(this.url.pathname);
  }

  // Attempt to get a running session
  this.getSession(this.handleSession);

}


WebRequest.prototype.serveStaticFile = function(resource) {

  /*
   * Function WebRequest.serveStaticFile
   * Servers static file to request
   */

  function getMIMEType(ext) {

    /*
     * Function WebRequest.serveStaticFile::getMIMEType
     * Returns the HTTP MIME type associated with the file extension
     */

    switch(ext) {
      case ".json":
        return ohttp.MIME.JSON;
      case ".ico":
        return ohttp.MIME.ICON;
      case ".css":
        return ohttp.MIME.CSS;
      case ".png":
        return ohttp.MIME.PNG;
      case ".js":
        return ohttp.MIME.JS;
      case ".sc3ml":
      case ".xml":
        return ohttp.MIME.XML;
      default:
        return ohttp.MIME.TEXT;
    }

  }

  // Write the HTTP header [200] with the appropriate MIME type
  this.response.writeHead(ohttp.S_HTTP_OK, getMIMEType(path.extname(resource)));

  // Pipe the response from the static folder
  this.pipe(path.join("static", resource));

}

WebRequest.prototype.pipe = function(resource) {

  /*
   * Function WebRequest.pipe
   * Pipes a single static resource to the response writeable stream
   */

  fs.createReadStream(resource).pipe(this.response);

}

WebRequest.prototype.getSession = function(sessionHandler) {

  /*
   * Function WebRequest.getSession
   * Attemps to get an existing session from the database
   */

  function extractSessionCookie(headers) {
  
    /*
     * Function WebRequest.getSession::extractSessionCookie
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

  sessionHandler = sessionHandler.bind(this);

  // Get the session identifier from HTTP Headers (cookie)
  var sessionIdentifier = extractSessionCookie(this.request.headers);

  // Get the session and pass 
  database.getSessionUser(sessionIdentifier, sessionHandler);

}

WebRequest.prototype.handleSession = function(error, session) {

  /*
   * Function WebRequest.handleSession
   * Callback fired when session is obtained
   */

  if(error) {
    return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
  }

  // For these paths a session is not required
  switch(this.url.pathname) {
    case "/":
      return this.redirect("/login");
    case "/login":
      return this.launchLogin(session);
    case "/logout":
      return this.removeSession(session);
    case "/authenticate":
      return this.launchAuthentication();
  }

  // No running session means unauthorized
  if(session === null) {
    return this.HTTPError(ohttp.E_HTTP_UNAUTHORIZED);
  }

  // Attach the session to the webrequest handler
  this.session = session;

  // Forward the request to the API
  if(this.url.pathname.startsWith("/api")) {
    return this.APIRequest();
  }

  // Forward requests to RPCs (administrators only)
  if(this.session.isAdministrator() && this.url.pathname.startsWith("/rpc")) {
    return this.RPC();
  }

  this.handleRouting();

}

WebRequest.prototype.handleRouting = function() {

  /*
   * Function WebRequest.handleRouting
   * Chooses function handler for the requested path
   */

  // Administrators
  if(this.session.isAdministrator()) {
    switch(this.url.pathname) {
      case "/user":
        return this.launchUser();
      case "/home/admin":
        return this.launchAdmin();
    }
  }

  // Serve the different pages
  switch(this.url.pathname) {
    case "/home":
      return this.launchHome();
    case "/send":
      return this.launchSend();
    case "/upload":
      return this.launchUpload();
    case "/seedlink":
      return this.launchSeedlink();
    case "/home/messages":
      return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateMessages(this.session));
    case "/home/messages/details":
      return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateMessageDetails(this.session));
    case "/home/messages/new":
      return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateNewMessageTemplate(this.request.url, this.session));
    case "/home/station":
      return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateStationDetails(this.session));
    default:
      return this.HTTPError(ohttp.E_HTTP_FILE_NOT_FOUND);
  }

}

WebRequest.prototype.RPC = function() {

  /*
   * Function WebRequest.RPC
   * Handler for remote procedure calls for service administrators
   */

  // Delegate the RPC to the appropriate function
  switch(this.url.pathname) {
    case "/rpc/inventory":
      return this.RPCInventory();
    case "/rpc/prototypes":
      return this.RPCPrototypes();
    case "/rpc/database":
      return this.RPCDatabase();
    case "/rpc/fdsnws":
      return this.RPCFDSNWS();
    default:
      return this.HTTPError(ohttp.E_HTTP_FILE_NOT_FOUND);
  }

}

WebRequest.prototype.writePrototype = function(parsedPrototype, buffer, callback) {

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

    seisComP3.convertSC3ML(input, output, function(stderr, code) {

      if(code !== 0) {
        return callback(new Error("Could not create SC3ML from station prototype"));
      }

      database.addPrototype(parsedPrototype, function(error, result) {

        // Propogate error
        if(error) {
          return callback(error);
        }

        logger.info("Inserted new network prototype for " + JSON.stringify(parsedPrototype.network));

        // A new network prototype was submitted (or changed) and we are required to supersede all metadata from this network
        // In this case, all stations from the network will be updated to match the new prototype
        // have their descriptions, restrictedStatus changed
        database.updateNetwork(parsedPrototype.network, function(error, files) {

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
          database.writeSubmittedFiles(this.session._id, XMLDocuments, callback);

        }.bind(this));

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.handlePrototypeUpdate = function(file, callback) {

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
      return callback(exception)
    }

    // Get the currently active prototype
    database.getActivePrototype(parsedPrototype.network, function(error, documents) {

      // Propogate error
      if(error) { 
        return callback(error);
      } 

      // Do nothing if the active prototype was resubmitted 
      if(documents.length !== 0 && parsedPrototype.sha256 === documents.pop().sha256) {
        return callback(null);
      }

      // Synchronously make sure the directory exists (blocks thread)
      createDirectory("./metadata/prototypes");

      // Write the prototype to disk
      this.writePrototype(parsedPrototype, buffer, callback);

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.readPrototypeDirectory = function(callback) {

  /*
   * Function WebRequest.readPrototypeDirectory
   * Reads the contents of the prototype directory
   */

  const PROTOTYPE_DIR = "./prototypes";

  // Read all prototypes from the directory
  fs.readdir(PROTOTYPE_DIR, function(error, files) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // Collect .xml files and add filepath to filenames
    callback(files.filter(x => x.endsWith(".xml")).map(x => path.join(PROTOTYPE_DIR, x)));

  }.bind(this));

}

WebRequest.prototype.RPCFDSNWS = function() {

  /*
   * Function WebRequest.RPCFDSNWS
   * Restarts the FDSNWS Webservice
   */

  seisComP3.restartFDSNWS(function(stderr, code) {

    if(code === 1) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR);
    }

    return this.redirect("/home/admin?S_RESTART_FDSNWS");

  }.bind(this));

}

WebRequest.prototype.RPCPrototypes = function() {

  /*
   * Function WebRequest.RPCPrototypes
   * Updates the network prototype definitions to the database
   */

  var next;

  // Collect all files from the prototype directory
  this.readPrototypeDirectory(function(files) {

    // Async but concurrently read all files
    (next = function() {

      // All buffers were read and available
      if(!files.length) {
        return this.redirect("/home/admin?S_UPDATE_PROTOTYPES");
      }

      // Delegate handling of prototype update
      this.handlePrototypeUpdate(files.pop(), function(error) {
     
        if(error) { 
          return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        next();

      }.bind(this));

    }.bind(this))();

  }.bind(this));

}

WebRequest.prototype.RPCDatabase = function() {

  /*
   * Function RPCInventory
   * Call to merge the entire inventory based on the most recent
   * ACCEPTED or COMPLETED metadata from the database
   */

  logger.info("RPC for database update received.");

  const inventoryFile = path.join("seiscomp3", "etc", "inventory", "inventory.xml");

  // Attempt to remove the previous merged XML
  fs.unlink(inventoryFile, function(error) {

    // ENOENT means file does not exist
    if(error && error.code !== "ENOENT") {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // Get the accepted inventory from the database
    database.getAcceptedInventory(function(error, documents) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // No metadata in the database
      if(documents.length === 0) {
        return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
      }

      var files = documents.map(x => x.filepath + ".sc3ml");

      seisComP3.mergeSC3ML(files, inventoryFile, function(stderr, code) {

        if(code !== 0) {
          return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR);
        }

        logger.info("RPC merged full inventory of " + documents.length + " files. Exited with status code " + code + ".");

        this.RPCUpdateInventory(documents);

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.RPCUpdateInventory = function(documents) {

  /*
   * Function RPCUpdateInventory
   * Updates the database with the accepted inventory
   */

  // Child process has closed
  seisComP3.updateInventory(function(stderr, code) {

    logger.info("SeisComP3 database has been updated. Exited with status code " + code + ".");

    // Error updating the database
    if(code !== 0) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR);
    }

    // Set all submitted files to being available/completed
    database.setAvailable(documents.map(x => x.id), function(error) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      seisComP3.restartFDSNWS(function(stderr, code) {

        if(code !== 0) {
          return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR);
        }

        this.redirect("/home/admin?S_RESTART_FDSNWS"); 

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.RPCInventory = function() {

  /*
   * Function RPCInventory
   * Call to merge the entire inventory based on the most recent
   * ACCEPTED or COMPLETED metadata from the database
   */

  const FILENAME = CONFIG.NODE.ID + "-sc3ml-full-inventory";

  logger.info("RPC for full inventory received.");

  // Query the database for all accepted files
  database.getAcceptedInventory(function(error, documents) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(documents.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    logger.info("RPC is merging " + documents.length + " inventory files.");

    var files = documents.map(x => x.filepath + ".sc3ml");
    var outstream = this.response;

    // Pass writeable as output file
    seisComP3.mergeSC3ML(files, outstream, function(stderr, code) { 
      logger.info("RPC merged full inventory of " + documents.length + " files. Exited with status code " + code + ".");
    });

  }.bind(this));

}


WebRequest.prototype.launchLogin = function(session) {

  /*
   * Function WebRequest.launchLogin
   * Launches login page if not signed in
   */

  // If the user is already logged in redirect to home page
  if(session !== null) {
    return this.redirect("/home");
  }

  return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateLogin(this.request.url));

}

WebRequest.prototype.launchAdmin = function() {

  /*
   * Function WebRequest.launchAdmin
   * Launches login page if not signed in
   */

  return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateAdmin(this.session));

}

WebRequest.prototype.launchAuthentication = function() {

  /*
   * Function WebRequest.launchAuthentication
   * Launches handler for user authentication
   */

  // Only implement the POST request
  if(this.request.method !== "POST") {
    return this.HTTPError(ohttp.E_HTTP_NOT_IMPLEMENTED);
  }

  // Attempt to parse the POST body passed by the HTML form
  // Contains username and password
  this.parseRequestBody("json", this.handleAuthenticationPOST);

}

WebRequest.prototype.launchUpload = function() {

  /*
   * Function WebRequest.launchUpload
   * Launches handler for file uploading
   */

  // Only accept POST requests
  if(this.request.method !== "POST") {
    return this.HTTPError(ohttp.E_HTTP_NOT_IMPLEMENTED);
  }

  // Block requests exceeding the configured limit (default 100MB)
  if(Number(this.request.headers["content-length"]) > CONFIG.MAXIMUM_POST_BYTES) {
    return this.HTTPError(ohttp.E_HTTP_PAYLOAD_TOO_LARGE);
  }

  // Parse the request multiform
  ohttp.handlePOSTForm(this.request, function(error, files) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(files.length === 0) {
      return this.HTTPResponse(ohttp.E_HTTP_BAD_REQUEST);
    }

    this.handleFileUpload(files, function(error) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      } 

      // All metadata was succesfully received
      return this.redirect("/home?S_METADATA_SUCCESS");

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.launchSeedlink = function() {

  /*
   * Function WebRequest.launchSeedlink
   * Launches Seedlink server submission code
   */

  const IPV4_ADDRESS_REGEX  = new RegExp("^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$");
  const HOSTNAME_REGEX = new RegExp("^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$");

  // Only accept POST requests
  if(this.request.method !== "POST") {
    return this.HTTPError(ohttp.E_HTTP_NOT_IMPLEMENTED);
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
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // The server is already in the database
      if(count !== 0) {
        return this.redirect("/home?E_SEEDLINK_SERVER_EXISTS");
      }

      database.seedlink().insertOne(storeObject, function(error, result) {

        if(error) {
          return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.redirect("/home?S_SEEDLINK_SERVER_SUCCESS");

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.launchHome = function() {

  /*
   * Function WebRequest.launchHome
   * Launchs the EIDA Manager homepage
   */

  // Update the last visit & app. version
  if(this.url.search === "?welcome") {
    database.updateUserVisit(this.session._id);
  }

  return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateProfile(this.session));

}

WebRequest.prototype.launchUser = function() {

  /*
   * Function WebRequest.launchUser
   * HTTP API operation for adding a new user
   */

  // Only allow administrators
  this.parseRequestBody("json", function(postBody) {

    // Add the user to the database
    database.addUser(postBody, function(error) { 

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      return this.redirect("/home/admin?S_ADD_USER");

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.launchSend = function() {

  /*
   * Function WebRequest.launchSend
   * Launchs code to handle message submission
   */

  function getRecipientQuery(session, recipient) {

    /* Function WebRequest.launchSend::getRecipientQuery
     * Returns query to find the recipient
     */

    if(session.isAdministrator() && recipient === "broadcast") {
      return {"username": {"$not": {"$eq": session.username}}}
    }

    if(recipient === "administrators") {
      return {"role": database.ROLES.ADMINISTRATOR, "username": {"$not": {"$eq": session.username}}}
    }

    return {"username": recipient}

  }

  // Parse the POSTed request body as JSON
  this.parseRequestBody("json", function(postBody) {

    // Disallow message to be sent to self
    if(postBody.recipient === this.session.username) {
      return this.redirect("/home/messages/new?self");
    }

    // Get the correct query depending on the recipient field
    var userQuery = getRecipientQuery(this.session, postBody.recipient);

    // Query the user database for the recipient name
    database.users().find(userQuery).toArray(function(error, users) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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
          postBody.subject,
          postBody.content
        );
      }.bind(this));

      // Store all messages
      database.messages().insertMany(messageBody, function(error, result) {

        // Error storing messages
        if(error) {
          return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.redirect("/home/messages/new?success");

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.removeSession = function(session) {

  /*
   * Function WebRequest.removeSession
   * Removes a session from the database collection
   */

  if(session === null) {
    this.redirect("/login?S_LOGGED_OUT");
  }

  logger.debug("Removing session for user " + session.username + " with session identifier " + session.sessionId);

  database.sessions().deleteOne({"sessionId": session.sessionId}, function(error, result) {
  
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.redirect("/login?S_LOGGED_OUT");
    
  }.bind(this)); 

}

WebRequest.prototype.handleAuthenticationPOST = function(credentials) {

  /*
   * Function WebRequest.handleParsedRequestPOST
   * Code that handles when credentials were posted to the /authenticate endpoint
   */

  // Check the user credentials
  this.authenticate(credentials, this.handleAuthentication);

}

WebRequest.prototype.handleAuthentication = function(error, user) {

  /*
   * Function WebRequest.handleAuthentication
   * Blocks requests with false credentials
   */

  // Authentication failed with invalid credentials
  if(error !== null) {
    return this.redirect("/login?" + error);
  }

  // Add a session to the database
  database.createSession(user, function(error, session) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.handleSessionCreation(session);

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
  this.response.writeHead(ohttp.S_HTTP_REDIRECT, {
    "Set-Cookie": cookie(session),
    "Location": "./home?welcome"
  });
 
  this.response.end();

}


WebRequest.prototype.authenticate = function(credentials, callback) {

  /*
   * WebRequest.authenticate
   * Authenticates the users against credentials in the database
   */

  callback = callback.bind(this);

  database.getUserByName(credentials.username, function(error, result) {

    // There was an error querying the database
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

WebRequest.prototype.parseRequestMultiform = function(parsedCallback) {

  /*
   * WebRequest.parseRequestMultiform
   * Calls multiparty library to handle parsing of multipart data
   */

  const form = new multiparty.Form();

  var files = new Array();

  // Asynchronously parse all files
  form.on("part", function(part) {

    var chunks = new Array();

    part.on("data", function(data) {
      chunks.push(data);
    });

    // Files have a filename, and parameters do not
    part.on("end", function() {
      files.push({
        "type": part.filename ? "file" : "parameter",
        "name": part.name,
        "data": Buffer.concat(chunks).toString()
      });
    });

  }.bind(this));

  // Parsing completed
  form.on("close", function() {
    parsedCallback(null, files);
  }.bind(this));

  // When an error occurs
  form.on("error", function(error) {
    parsedCallback(error);
  });

  // Attach
  form.parse(this.request);

}

WebRequest.prototype.parseRequestBody = function(type, callback) {

  /*
   * Function WebRequest.parseRequestBody
   * Parses a request body received from the client
   * TODO let multiparty handle this
   */

  callback = callback.bind(this);

  var chunks = new Array();

  // Data received from client
  this.request.on("data", function(chunk) {

    chunks.push(chunk);

    // Limit the maximum number of bytes that can be posted
    if(sum(chunks) > CONFIG.MAXIMUM_POST_BYTES) {
      return this.HTTPError(ohttp.E_HTTP_PAYLOAD_TOO_LARGE);
    }

  }.bind(this));

  // Request has been ended by client
  this.request.on("end", function() {

    // The request was aborted by the server
    if(this.response.finished) {
      return;
    }

    // Support for different types of data
    switch(type) {
      case "json":
        return callback(querystring.parse(Buffer.concat(chunks).toString()));
      default:
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR);
    }

  }.bind(this));

}

WebRequest.prototype.redirect = function(path) {

  /*
   * Function WebRequest.redirect
   * Redirects the client to another page
   */

  this.response.writeHead(ohttp.S_HTTP_REDIRECT, {"Location": path});
  this.response.end();

}

WebRequest.prototype.HTTPResponse = function(statusCode, HTML) {

  /*
   * Function WebRequest.HTTPResponse
   * Returns an HTTP error to the client
   */

  // Handle 204
  if(statusCode === ohttp.S_HTTP_NO_CONTENT) {
    this.response.writeHead(statusCode);
    this.response.end();
    return;
  }

  // Write the HTML response
  this.response.writeHead(statusCode, ohttp.MIME.HTML);
  this.response.write(HTML);
  this.response.end();

}

WebRequest.prototype.HTTPError = function(statusCode, error) {

  /*
   * Function WebRequest.HTTPError
   * Returns an HTTP error to the client
   */

  // Write the error to the log file
  if(error) {
    logger.error(error);
  }

  // Delegate to the generic HTTPResponse function
  this.HTTPResponse(statusCode, template.generateHTTPError(statusCode, error));

}

function getHost() {

  return {
   "host": process.env.SERVICE_HOST || CONFIG.HOST,
   "port": process.env.SERVICE_PORT || CONFIG.PORT
  }

}

var Webserver = function() {

  /*
   * Class Webserver
   * Opens NodeJS webservice on given PORT and handles all incoming connections
   */

  // Create the HTTP server and listen to incoming requests
  this.webserver = createServer(this.handleRequest);

  const { host, port } = this.getHost();

  // Listen to incoming connections
  this.webserver.listen(port, host, function() {
    logger.info("EIDA Manager webserver started at " + host + ":" + port);
  });

  // When the webserver is closed: shut down the database
  this.webserver.on("close", function() {
    database.close(function() {
      process.exit(0);
    });
  });

  // Graceful shutdown of server on interrupt
  process.once("SIGINT", this.interrupt.bind(this));
  process.once("SIGTERM", this.interrupt.bind(this));

}

Webserver.prototype.handleRequest = function(request, response) {

  /*
   * Function Webserver.handleRequest
   * Handles any incoming HTTP requests to the webserver
   */

  new WebRequest(request, response).init();

}

Webserver.prototype.getHost = function() {

  /*
   * Function Webserver.getHost
   * Returns host from environment variables (docker) or configuration
   */

  return {
   "host": process.env.SERVICE_HOST || CONFIG.HOST || "127.0.0.1",
   "port": process.env.SERVICE_PORT || CONFIG.PORT || 3000
  }

}

Webserver.prototype.interrupt = function() {

  /*
   * Function Webserver.interrupt
   * Signal handler for SIGINT and SIGTERM signals
   */

  logger.info("Interrupt signal received - initializing graceful shutdown of webserver and database connection.");

  // Close the webserver
  this.webserver.close()

}

WebRequest.prototype.handleFileUpload = function(objects, callback) {

  /*
   * Function WebRequest.handleFileUpload
   * Writes multiple (split) StationXML files to disk
   */

  function getNetworkProperties(properties, prototype) {

    /* Function WebRequest.handleFileUpload::getNetworkProperties
     * Extracts properties passed through MultiParty form
     */

    var propertyObject = {
      "restricted": properties.restricted !== undefined  && properties.restricted === "on",
      "description": prototype.description,
      "netRestricted": prototype.restricted,
      "end": prototype.end,
      "code": prototype.network.code,
      "start": prototype.network.start
    }

    // Network prototype is restricted: must propogate to stations
    if(propertyObject.netRestricted) {
      propertyObject.restricted = true;
    }

    return propertyObject;

  }

  // Get properties from the network
  var properties = getNetworkProperties(objects.properties, this.session.prototype);

  // We split any submitted StationXML files to the station level
  try {
    var XMLDocuments = splitStationXML(objects.files, properties);
  } catch(exception) {
    return callback(exception);
  }

  // Assert that directories exist for the submitted files (synchronous)
  XMLDocuments.forEach(x => createDirectory(x.metadata.filepath));

  // Delegate writing of files: pass id to match user to file
  database.writeSubmittedFiles(this.session._id, XMLDocuments, callback);

}

WebRequest.prototype.APIRequest = function() {

  /*
   * Fuction WebRequest.APIRequest
   * All requests to the ORFEUS API go through here
   */

  // Only get the first query parameter (jQuery may add another one to prevent caching)
  var search = this.url.search ? this.url.search.split("&").shift() : null;

  if(this.session.isAdministrator()) {
    switch(this.url.pathname) {
      case "/api/prototypes":
        return this.getAllNetworkPrototypes();
      case "/api/users":
        return this.getUsers();
    }
  }

  // Register new routes here
  switch(this.url.pathname) {
    case "/api/prototype":
      return this.getNetworkPrototype();
    case "/api/seedlink":
      return this.getSeedlinkServers();
    case "/api/history":
      return this.getMetadataHistory();
    case "/api/latency":
      return this.getStationLatencies();
    case "/api/stations":
      return this.getFDSNWSStations();
    case "/api/staged":
      return this.getStagedFiles();
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
          return this.HTTPError(ohttp.E_HTTP_NOT_IMPLEMENTED);
      }
    default:
      return this.HTTPError(ohttp.E_HTTP_FILE_NOT_FOUND);
  }

}

WebRequest.prototype.getUsers = function() {

  /*
   * Function WebRequest.getUsers
   * Returns a list of the users in the application
   */

  database.getAllUsers(function(error, documents) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(documents.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    this.writeJSON(documents);

  }.bind(this));

}

WebRequest.prototype.getAllNetworkPrototypes = function() {

  /*
   * WebRequest.prototype.getAllNetworkPrototypes
   * API that returns a list of the network prototypes defined in the database
   */

  // Get all the prototypes from the database
  database.getPrototypes(function(error, documents) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(documents.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    this.writeJSON(documents);

  }.bind(this));

}

WebRequest.prototype.getNetworkPrototype = function() {

  /*
   * Function WebRequest.getNetworkPrototype
   * Returns the active network prototype for this session
   */

  function getPrototypeFile(document) {

    /*
     * Function WebRequest.getNetworkPrototype::getPrototypeFile
     * Returns the file location on disk of the prototype
     */

    return path.join("metadata", "prototypes", document.sha256 + ".stationXML");

  }

  // If admin & an id parameter was passed, make a different query
  if(this.session.isAdministrator() && this.query.id) {
    var findQuery = {"sha256": this.query.id}
  } else {
    var findQuery = {"network": this.session.prototype.network}
  }

  database.prototypes().find(findQuery).sort({"created": database.DESCENDING}).limit(1).toArray(function(error, documents) {
    
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(documents.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    // Pipe the prototype file to the user
    this.pipe(getPrototypeFile(documents.pop()));

  }.bind(this));

}

WebRequest.prototype.removeMetadata = function(id) {

  /*
   * Function WebRequest.removeMetadata
   * Writes metadata file from disk to user
   */

  // Pass the identifier and network
  database.supersedeFileByHash(this.session, id, function(error) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // Succesfully deleted: send 204
    return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);

  }.bind(this));

}

WebRequest.prototype.pipeMetadata = function(id) {

  /*
   * Function WebRequest.pipeMetadata
   * Pipes a metadata file from disk to user
   */

  // Find a document that matches the identifier
  database.getFileByHash(id, function(error, result) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(result === null) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    // Pipe the response
    this.pipe(result.filepath + ".stationXML");

  }.bind(this));

}

WebRequest.prototype.getMetadataFile = function(id) {

  /*
   * Function WebRequest.getMetadataFile
   * RESTful API handling for getting or deleting metadata
   */

  switch(this.request.method) {
    case "DELETE":
      return this.removeMetadata(id);
    case "GET":
      return this.pipeMetadata(id);
    default:
      return this.HTTPError(ohttp.E_HTTP_NOT_IMPLEMENTED);
  }

}

WebRequest.prototype.getMetadataHistory = function() {

  /*
   * Function WebRequest.getMetadataHistory
   * Queries database for full metadata history of single station
   */

  // Parse the query string
  // If an id parameter was passed
  if(this.query.id) {
    return this.getMetadataFile(this.query.id);
  }

  // Get the file by network and station identifier
  database.getFilesByStation(this.session, this.query, function(error, results) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(results.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    this.writeJSON(results);

  }.bind(this));

}

WebRequest.prototype.getSeedlinkServers = function() {

  /*
   * Function WebRequest.getSeedlinkServers
   * Returns submitted seedlink servers from the database
   */

  // Query the database for submitted servers
  database.getSeedlinkServers(this.session, function(error, results) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // No servers found in the database
    if(results.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    // Look up DNS records
    ohttp.getDNSLookup(this.session.prototype.network.code, results, function(servers) {
      this.writeJSON(servers);
    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.removeAllMessagesSent = function() {

  /*
   * Function WebRequest.removeAllMessagesSent
   * Sets all messages for user to deleted
   */

  var query = {
    "sender": database.ObjectId(this.session._id),
    "senderDeleted": false
  }

  // Get specific message from the database
  database.messages().updateMany(query, {"$set": {"senderDeleted": true}}, function(error, messages) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(messages);

  }.bind(this));

}

WebRequest.prototype.removeAllMessages = function() {

  /*
   * Function WebRequest.removeAllMessages
   * Sets all messages for user to deleted
   */

  var query = {
    "recipient": database.ObjectId(this.session._id),
    "recipientDeleted": false
  }

  // Get specific message from the database
  database.messages().updateMany(query, {"$set": {"recipientDeleted": true}}, function(error, messages) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(messages);

  }.bind(this));

}

WebRequest.prototype.removeSpecificMessage = function() {

  /*
   * Function WebRequest.RemoveSpecificMessage
   * Sets message with particular id to deleted
   * We have no way of knowing whether the sender of recipient is deleting (FIXME)
   */

  // Get the message identifier from the query string
  var senderQuery = {
    "sender": database.ObjectId(this.session._id),
    "senderDeleted": false,
    "_id": database.ObjectId(this.query.id)
  }

  var recipientQuery = {
    "recipient": database.ObjectId(this.session._id),
    "recipientDeleted": false,
    "_id": database.ObjectId(this.query.id)
  }

  // Get specific message from the database
  database.messages().updateOne(recipientQuery, {"$set": {"recipientDeleted": true}}, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(message.result.nModified !== 0) {
      return this.writeJSON({"status": "deleted"});
    }

    database.messages().updateOne(senderQuery, {"$set": {"senderDeleted": true}}, function(error, message) {

      // Could not find message
      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      if(message.result.nModified !== 0) {
        return this.writeJSON({"status": "deleted"});
      }

      return this.writeJSON({"status": "error"});

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.getSpecificMessage = function() {

  /*
   * Function GetSpecificMessage
   * Returns a specific private message
   */

  // Get specific message from the database
  database.getMessageById(this.session._id, this.query.id, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(message === null) {
      return this.writeJSON(null);
    }

    // Check if the author of the message is the owner of the session
    var author = message.sender.toString() === this.session._id.toString();

    // If requestee is not the author: set the message to read (background)
    if(!author && !message.read) {
      database.setMessageRead(message._id);
    }

    var userIdentifier = author ? message.recipient : message.sender;

    // Find the username for the message sender 
    database.getUserById(userIdentifier, function(error, user) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

  /*
   * Function WebRequest.getNewMessages
   * Return the number of new messages 
   */

  database.getNewMessageCount(this.session._id, function(error, count) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON({"count": count});

  }.bind(this));

}

WebRequest.prototype.getMessages = function() {

  /*
   * Function WebRequest.getMessages
   * Returns all messages that belong to a user in a session
   */

  database.getMessages(this.session._id, function(error, documents) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // All senders and recipient identifiers
    var userIdentifiers = documents.map(x => database.ObjectId(x.sender)).concat(documents.map(x => database.ObjectId(x.recipient)));

    // Get usernames from user identifiers
    database.getUsersById(userIdentifiers, function(error, users) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
      }

      // Create a simple hashMap that maps id to username 

      var hashMap = new Object();
      users.forEach(function(x) {
        hashMap[x._id] = {"username": x.username, "role": x.role};
      });

      // Create a JSON with the message contents
      var messageContents = documents.map(function(x) {

        // Body payload
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

  /*
   * Function WebRequest.getStationLatencies
   * Returns Seedlink latencies for a network, station
   */

  ohttp.request("http://" + CONFIG.LATENCY.HOST + ":" + CONFIG.LATENCY.PORT + this.url.search, function(json) {
    this.writeJSON(JSON.parse(json));
  }.bind(this));

}

WebRequest.prototype.writeJSON = function(json) {

  /*
   * Function WebRequest.writeJSON
   * Writes JSON to client
   */

  // Send 204 NO CONTENT 
  if(json === null) {
    return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
  }

  if(json === undefined) {
    return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, new Error("Writing undefined JSON"));
  }

  // This is bound to the response
  this.response.writeHead(ohttp.S_HTTP_OK, {"Content-Type": "application/json"});
  this.response.write(JSON.stringify(json));
  this.response.end();

}


WebRequest.prototype.getFDSNWSChannels = function() {

  /*
   * Function WebRequest.getFDSNWSChannels
   * Returns the channels for a given station from FDSNWS
   */

  var queryString = querystring.stringify({
    "level": "channel",
    "format": "text",
  });

  // If a network end is specified only show channels from before the network end time
  // Extend the query string
  queryString += "&" + this.url.query;

  ohttp.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    this.writeJSON(this.parseFDSNWSResponse(json));
  }.bind(this));

}

WebRequest.prototype.parseFDSNWSResponse = function(data) {

  /* function WebRequest.ParseFDSNWSResponse
   * Returns parsed JSON response from FDSNWS Station Webservice
   * for varying levels of information
   */

  function stationObject(codes) {

    /* function WebRequest.ParseFDSNWSResponse::stationObject
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

    /* function WebRequest.ParseFDSNWSResponse::channelObject
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
      "azimuth": Number(codes[8]),
      "dip": Number(codes[9]),
      "description": codes[10],
      "gain": Number(codes[11]),
      "gainFrequency": Number(codes[12]),
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

WebRequest.prototype.getStagedFiles = function() {

  /*
   * Function WebRequest.getStagedFiles
   * Returns the files that are staged
   */

  // Find all metadata in these processing pipeline
  var findQuery = {
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

  // Filter anything that does not belong to the user
  if(!this.session.isAdministrator()) {
    findQuery["network.code"] = this.session.prototype.network.code;
    findQuery["network.start"] = this.session.prototype.network.start;
  }

  // Get the staged files from the database
  database.getStagedFiles(findQuery, function(error, files) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(files);

  }.bind(this));

}

WebRequest.prototype.getFDSNWSStations = function() {

  /*
   * Function WebRequest.GetFDSNWSStations
   * Returns station information from FDSNWS Station
   */

  // Query information for the session network
  var queryString = querystring.stringify({
    "level": "station",
    "format": "text",
    "network": this.session.prototype.network.code
  });

  // If the network end is specified only show stations from before the network end
  ohttp.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    this.writeJSON(this.parseFDSNWSResponse(json));
  }.bind(this));

}

if(require.main === module) {

  // Init the server
  __init__();

}

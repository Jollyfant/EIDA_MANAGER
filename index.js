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

const childProcess = require("child_process");

// Native includes
const { createServer } = require("http");
const path = require("path");
const url = require("url");
const fs = require("fs");
const querystring = require("querystring");

// Third-party libs
const multiparty = require("multiparty");

// ORFEUS libs
const { User, Session } = require("./lib/orfeus-session");
const { SHA256 } = require("./lib/orfeus-crypto");
const { sum, createDirectory, escapeHTML } = require("./lib/orfeus-util");
const { parsePrototype, splitStationXML } = require("./lib/orfeus-metadata.js");
const database = require("./lib/orfeus-database");
const logger = require("./lib/orfeus-logging");
const ohttp = require("./lib/orfeus-http");
const template = require("./lib/orfeus-template");

// Static information
const CONFIG = require("./config");
const STATIC_FILES = require("./lib/orfeus-static");

function init() {

  /* function init
   * Initializes the application
   */

  // Attempt to connect to the database
  database.connect(function(error) {
  
    // Could not connect to Mongo: retry in 1 second
    if(error) {
      setTimeout(init, 1000);
      return logger.fatal(error);
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

  /* Function WebRequest.serveStaticFile
   * Servers static file to request
   */

  function getMIMEType(ext) {

    /* Function WebRequest.serveStaticFile::getMIMEType
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
        return ohttp.MIME.XML;
      default:
        return ohttp.MIME.TEXT;
    }

  }

  // Write the HTTP header [200] with the appropriate MIME type
  this.response.writeHead(ohttp.S_HTTP_OK, getMIMEType(path.extname(resource)));

  // Pipe the response
  this.pipe(path.join("static", resource));

}

WebRequest.prototype.pipe = function(resource) {

  /* function WebRequest.pipe
   * Pipes a single resource to the response writeable stream
   */

  fs.createReadStream(resource).pipe(this.response);

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
  database.getSession(sessionIdentifier, function(error, session) {

    // Error querying the database
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // The session does not exist
    if(session === null) {
      return callback(null);
    }

    // Get the user that belongs to the session
    database.getUserById(session.userId, function(error, user) {

      // Error querying the database
      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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
      return this.launchLogin(session);
    case "/authenticate":
      return this.launchAuthentication();
  }

  // No running session means unauthorized
  if(session === null) {
    return this.HTTPError(ohttp.E_HTTP_UNAUTHORIZED);
  }

  // Attach the session
  this.session = session;

  // Forward the request to the API
  if(this.url.pathname.startsWith("/api")) {
    return this.APIRequest();
  }

  // Forward RPCs
  if(this.url.pathname.startsWith("/rpc")) {
    return this.RPC();
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
    case "/home/admin":
      return this.launchAdmin();
    case "/home/messages":
      return this.HTTPResponse(200, template.generateMessages(this.session));
    case "/home/messages/details":
      return this.HTTPResponse(200, template.generateMessageDetails(this.session));
    case "/home/messages/new":
      return this.HTTPResponse(200, template.generateNewMessageTemplate(this.request.url, this.session));
    case "/home/station":
      return this.HTTPResponse(200, template.generateStationDetails(this.session));
    default:
      return this.HTTPError(ohttp.E_HTTP_FILE_NOT_FOUND);
  }

}

WebRequest.prototype.RPC = function() {

  /* WebRequest.RPC
   * Handler for remote procedure calls for
   * service administrators
   */

  if(this.session.role !== "admin") {
    return this.HTTPError(ohttp.E_HTTP_FORBIDDEN); 
  }

  switch(this.url.pathname) {
    case "/rpc/inventory":
      return this.RPCInventory();
    case "/rpc/prototypes":
      return this.RPCPrototypes();
    default:
      return this.HTTPError(ohttp.E_HTTP_FILE_NOT_FOUND);
  }

}

WebRequest.prototype.handlePrototype = function(buffer, callback) {

  /* WebRequest.handlePrototypes
   * Updates the network prototype definitions to the database
   */

  // Try parsing the prototype files
  try {
    var parsedPrototype = parsePrototype(buffer);
  } catch(exception) {
    return callback(exception)
  }

  // Check if the prototype already exists in the database
  database.prototypes().findOne({"sha256": parsedPrototype.sha256}, function(error, document) {

    if(error) { 
      return callback(error);
    } 

    // Hash is in the database: skip!
    if(document !== null) {
      return callback(null);
    }

    // Write the prototype to disk
    fs.writeFile(path.join("./metadata/prototypes", parsedPrototype.sha256 + ".stationXML"), buffer, function(error) {

      if(error) {
        return callback(error);
      }

      // Insert the new (modified) prototype
      database.prototypes().insertOne(parsedPrototype, function(error, result) {

        if(error) {
          return callback(error);
        }

        logger.info("Inserted new network prototype for (" + JSON.stringify(parsedPrototype.network) + ")");

        // A new network prototype was submitted (or changed) and we are required to supersede all metadata from this network
        // Note: it is highly unrecommended to change an existing network prototype once it is defined
        // the consequence is that network operators must specify new station metadata that matches the new prototype
        database.supersedeNetwork(parsedPrototype.network, function(error) {

          if(error) {
            return callback(error);
          }

          callback(null);
         
        });

      }.bind(this));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.readPrototypeDirectory = function(callback) {

  /* WebRequest.readPrototypeDirectory
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

WebRequest.prototype.RPCPrototypes = function() {

  /* WebRequest.RPCPrototypes
   * Updates new network prototype definitions to the database
   */

  this.readPrototypeDirectory(function(files) {

    var readPrototypeFile;

    // Async but concurrent
    (readPrototypeFile = function() {

      // All buffers were read and available
      if(!files.length) {
        return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
      }

      var filename = files.pop();

      fs.readFile(filename, function(error, data) {

        if(error) {
          return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
        }

        this.handlePrototype(data, function(error) {
     
          if(error) { 
            return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
          }

          readPrototypeFile();

        }.bind(this));

      }.bind(this));

    }.bind(this))();

  }.bind(this));

}

WebRequest.prototype.RPCInventory = function() {

  /* Function RPCInventory
   * Call to merge the entire inventory based on the most recent
   * ACCEPTED or COMPLETED metadata
   */

  const FILENAME = CONFIG.NODE.ID + "-sc3ml-full-inventory";

  logger.info("RPC for full inventory received.");

  // Query the database for all accepted files
  database.getAcceptedInventory(function(error, documents) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(documents.length === 0) {
      return this.HTTPError(ohttp.S_HTTP_NO_CONTENT);
    }

    logger.info("RPC is merging " + documents.length + " inventory files.");

    // Get the SC3ML filenames and add them to the CMDline
    var SEISCOMP_COMMAND = [
      "--asroot",
      "exec",
      "scinv",
      "merge"
    ].concat(documents.map(x => x.filepath + ".sc3ml"));

    // Spawn the SeisComP3 subprocess
    const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

    // ENOENT SeisComP3
    convertor.on("error", function(error) {
      this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }.bind(this));

    // Set the HTTP header for the request
    convertor.stdout.once("data", function() {
      this.response.writeHead(ohttp.S_HTTP_OK, {"Content-Disposition": "attachment;filename=" + FILENAME});
    }.bind(this));

    // Pipe stdout of SeisComP3 to the response
    convertor.stdout.pipe(this.response);

    // NOOP but required..
    convertor.stderr.on("data", function() { });

    // Child process has closed
    convertor.on("close", function(code) {
      logger.info("RPC merged full inventory of " + documents.length + " files. Exited with status code " + code + ".");
    });

  }.bind(this));

}


WebRequest.prototype.launchLogin = function(session) {

  /* Function WebRequest.launchLogin
   * Launches login page if not signed in
   */

  // If the user is already logged in redirect to home page
  if(session !== null) {
    return this.redirect("/home");
  }

  return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateLogin(this.request.url));

}

WebRequest.prototype.launchAdmin = function() {

  if(this.session.role !== "admin") {
    return this.HTTPError(ohttp.E_HTTP_FORBIDDEN);
  }

  return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateAdmin(this.session));

}

WebRequest.prototype.launchAuthentication = function() {

  /* Function WebRequest.launchAuthentication
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

  /* Function WebRequest.launchUpload
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
  this.parseRequestMultiform(function(files) {

    this.handleFileUpload(files, function(error) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

  /* Function WebRequest.launchHome
   * Launchs the EIDA Manager homepage
   */

  // Update the last visit & app. version
  if(this.url.search === "?welcome") {
    database.users().updateOne({"_id": this.session._id}, {"$set": {"version": CONFIG.__VERSION__, "visited": new Date()}});
  }

  return this.HTTPResponse(ohttp.S_HTTP_OK, template.generateProfile(this.session));

}

WebRequest.prototype.launchSend = function() {

  /* Function WebRequest.launchSend
   * Launchs code to handle message submission
   */

  function getRecipientQuery(session, recipient) {

    /* Function WebRequest.launchSend::getRecipientQuery
     * Returns query to find the recipient
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
          escapeHTML(postBody.subject),
          escapeHTML(postBody.content)
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

WebRequest.prototype.removeSession = function() {

  /* Function WebRequest.removeSession
   * Removes a session from the database collection
   */

  logger.debug("Removing session for user " + this.session.username + " with session identifier " + this.session.sessionId);

  database.sessions().deleteOne({"sessionId": this.session.sessionId}, function(error, result) {
  
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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
    "sessionId": session.id,
    "userId": user._id,
    "created": new Date()
  }

  // Insert a new session
  database.sessions().insertOne(storeObject, function(error, result) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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
  this.response.writeHead(ohttp.S_HTTP_REDIRECT, {
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

  /* WebRequest.parseRequestMultiform
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
    parsedCallback(files);
  }.bind(this));

  // Start parsing
  form.parse(this.request);

}

WebRequest.prototype.parseRequestBody = function(type, callback) {

  /* Function WebRequest.parseRequestBody
   * Parses a request body received from the client
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

    // Add all chunks to a string buffer
    var fullBuffer = Buffer.concat(chunks);

    // Support for different types of data
    switch(type) {
      case "json":
        return callback(querystring.parse(fullBuffer.toString()));
      default:
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR);
    }

  }.bind(this));

}

WebRequest.prototype.redirect = function(path) {

  /* Function WebRequest.redirect
   * Redirects the client to another page
   */

  this.response.writeHead(ohttp.S_HTTP_REDIRECT, {"Location": path});
  this.response.end();

}

WebRequest.prototype.HTTPResponse = function(statusCode, HTML) {

  /* Function WebRequest.HTTPResponse
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

  // Read from env variables or configuration
  var host = process.env.SERVICE_HOST || CONFIG.HOST;
  var port = process.env.SERVICE_PORT || CONFIG.PORT;

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

  // Graceful shutdown of server
  process.on("SIGINT", this.SIGINT.bind(this));

}

Webserver.prototype.SIGINT = function() {

  /* Function Webserver.SIGINT
   * Signal handler for SIGINT
   */

  process.exit(0);
  logger.info("SIGINT received - initializing graceful shutdown of webserver and database connection.");

  this.webserver.close()

}

WebRequest.prototype.handleFileUpload = function(files, callback) {

  /* Function WebRequest.handleFileUpload
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
    if(this.session.role !== "admin" && JSON.stringify(this.session.network) !== JSON.stringify(XMLDocuments[i].metadata.network)) {
      return callback(new Error("User does not own network rights.")); 
    }
  }

  if(XMLDocuments.length === 0) {
    return callback(new Error("No metadata was submitted."));
  }

  // Assert that directories exist for the submitted files
  XMLDocuments.forEach(x => createDirectory(x.metadata.filepath));

  this.writeSubmittedFiles(XMLDocuments, callback);

}

WebRequest.prototype.messageAdministrators = function(filenames) {

 /* function messageAdministrators
  * Queries the database for all administrators
  */

  // No files were uploaded
  if(filenames.length === 0) {
    return;
  }

  // Get all ORFEUS administrators
  database.getAdministrators(function(error, administrators) {

    if(error) {
      return logger.error(error);
    }

    // No administrators
    if(administrators.length === 0) {
      return logger.info("No administrators could be found");
    }

    // Message each administrator but skip messaging self
    var messages = administrators.filter(x => x._id.toString() !== this.session._id.toString()).map(function(administrator) {

      return Message(
        administrator._id,
        this.session._id,
        "New Metadata Uploaded",
        "New metadata has been submitted for station(s): " + filenames.map(escapeHTML).join(", ")
      );

    }.bind(this));

    if(messages.length === 0) {
      return;
    }

    // Store the messages
    database.storeMessages(messages, function(error, result) {

      if(error) {
        logger.error(error);
      } else {
        logger.info("Messaged " + administrators.length + " adminstrators about " + filenames.length + " file(s) uploaded.");
      }

    });

  }.bind(this));

}

WebRequest.prototype.writeSubmittedFiles = function(XMLDocuments, callback) {

  var writeNextFile;
  var submittedFiles = new Array();

  // Asynchronous writing for multiple files to disk and
  // adding metadata to the database
  (writeNextFile = function() {

    // Finished writing all documents
    if(!XMLDocuments.length) {

      // Write a private message to each administrator
      this.messageAdministrators(submittedFiles);

      // Fire callback without an error
      return callback(null);

    }

    // Get the next queued file
    var file = XMLDocuments.pop();

    // Extact metadata for the file
    var metadata = {
      "error": null,
      "available": null,
      "filename": file.metadata.id,
      "modified": null,
      "network": file.metadata.network,
      "station": file.metadata.station,
      "nChannels": file.metadata.nChannels,
      "filepath": path.join(file.metadata.filepath, file.metadata.sha256),
      "type": "FDSNStationXML",
      "size": file.metadata.size,
      "status": database.METADATA_STATUS_PENDING,
      "userId": this.session._id,
      "created": new Date(),
      "sha256": file.metadata.sha256
    }

    // Check if the file (sha256) is already in the database
    // Since it is pointless to store multiple objects for the same file
    // Superseded files ALWAYS stay in the database to keep a history
    database.files().findOne({"sha256": metadata.sha256, "status": {"$ne": database.METADATA_STATUS_SUPERSEDED}}, function(error, document) {

      if(error) {
        return callback(error);
      }

      if(document !== null) {
        return writeNextFile();
      }

      // Insert the new (or updated) metadata document
      database.files().insertOne(metadata, function(error, document) {

        if(error) {
          logger.error("Could not insert new metadata object for " + metadata.filename);
        } else {
          logger.info("Inserted new metadata object for " + metadata.filename);
        }

        if(error) {
          return callback(error);
        }

        // NodeJS stdlib for writing file
        fs.writeFile(path.join(metadata.filepath + ".stationXML"), file.data, function(error) {

          if(error) {
            logger.error("Could not write file " + metadata.filename + " to disk (" + metadata.sha256 + ")");
          } else {
            logger.info("Writing file for " + metadata.filename + " to disk (" + metadata.sha256 + ")");
          }

          if(error) {
            return callback(error);
          }

          // Supersede previous metadata documents (outdated metadata)
          database.supersedeFileByStation(document.insertedId, metadata, function(error) {

            if(error) {
              return callback(error);
            }

            // Save the written filename for a message sent to the administrators
            submittedFiles.push(metadata.filename);

            // More files to write
            writeNextFile();

          });

        });

      });

    });

  }.bind(this))();

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
          return this.HTTPError(ohttp.E_HTTP_NOT_IMPLEMENTED);
      }
    default:
      return this.HTTPError(ohttp.E_HTTP_FILE_NOT_FOUND);

  }

}

WebRequest.prototype.getNetworkPrototype = function() {

  /* WebRequest.getNetworkPrototype
   * Returns the active network prototype for this session
   */

  function getPrototypeFile(document) {
    return path.join("metadata", "prototypes", document.sha256 + ".stationxml");
  }

  database.prototypes().find({"network": this.session.network}).sort({"created": database.DESCENDING}).limit(1).toArray(function(error, documents) {
    
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

  /* Function WebRequest.removeMetadata
   * Writes metadata file from disk to user
   */

  // Pass the identifier and network
  database.supersedeFileByHash(this.session, id, function(error) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);

  }.bind(this));

}

WebRequest.prototype.pipeMetadata = function(id) {

  /* WebRequest.pipeMetadata
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
    this.pipe(result.filepath + ".stationxml");

  }.bind(this));

}

WebRequest.prototype.getMetadataFile = function(id) {

  /* Function WebRequest.getMetadataFile
   * Writes metadata file from disk to user
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

  /* Function WebRequest.getMetadataHistory
   * Queries database for full metadata history of single station
   */

  // Parse the query string
  var queryString = querystring.parse(this.url.query);

  // If an id parameter was passed
  if(queryString.id) {
    return this.getMetadataFile(queryString.id);
  }

  // Get the file by network and station identifier
  database.getFilesByStation(this.session, queryString, function(error, results) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(results.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    this.writeJSON(results);

  }.bind(this));

}

WebRequest.prototype.getDNSLookup = function(servers) {

  /* Function WebRequest.getDNSLookup
   * Does a DNS lookup on Seedlink servers and proceeds with response
   */

  const SEEDLINK_API_URL = "http://" + CONFIG.STATIONS.HOST + ":" + CONFIG.STATIONS.PORT;

  // Query the DNS records
  ohttp.getDNS(servers, function(DNSRecords) {

    // Combine all servers and ports
    var serversAndPorts = DNSRecords.map(x => x.host + ":" + x.port).join(",");

    // Make the request to the internal API
    ohttp.request(SEEDLINK_API_URL + "?host=" + serversAndPorts, function(seedlinkServers) {

      if(seedlinkServers === null) {
        return this.writeJSON(DNSRecords);
      }

      this.attachSeedlinkMetadata(DNSRecords, JSON.parse(seedlinkServers));

    }.bind(this));

  }.bind(this));

}

WebRequest.prototype.attachSeedlinkMetadata = function(DNSRecords, seedlinkServers) {

  /* Function WebRequest.attachSeedlinkMetadata
   * Attaches seedlink metadata (e.g. version, identifier) to a DNS record
   */

 // Attach seedlink metadata to each DNS record
 var results = DNSRecords.map(function(x) {

   // Naively try to match every seedlink server
   for(var i = 0; i < seedlinkServers.length; i++) {

     var seedlinkServer = seedlinkServers[i];

     // Match: extend metadata
     if(seedlinkServer.server.host === x.host && seedlinkServer.server.port === x.port) {
       return {
         "host": x.host,
         "ip": x.ip,
         "port": x.port,
         "identifier": seedlinkServer.identifier,
         "connected": seedlinkServer.connected,
         "version": seedlinkServer.version,
         "stations": seedlinkServer.error === "CATNOTIMPLEMENTED" ? null : seedlinkServer.stations.filter(station => station.network === this.session.network.code)
       }
     }

   }

   return x;

 }.bind(this));

 this.writeJSON(results);

}

WebRequest.prototype.getSeedlinkServers = function() {

  /* Function WebRequest.getSeedlinkServers
   * Returns submitted seedlink servers from the database
   */

  // Query the database for submitted servers
  database.seedlink().find({"userId": this.session._id}).toArray(function(error, results) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    // No servers found in the database
    if(results.length === 0) {
      return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
    }

    this.getDNSLookup(results);

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
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(messages);

  }.bind(this));

}

WebRequest.prototype.removeAllMessages = function() {

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
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

  /* Function GetSpecificMessage
   * Returns a specific private message
   */

  var queryString = querystring.parse(this.url.query);

  // Get specific message from the database
  database.getMessageById(this.session._id, queryString.id, function(error, message) {

    // Could not find message
    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    if(message === null) {
      return this.writeJSON(null);
    }

    // Check if the author of the message is the owner of the session
    var author = message.sender.toString() === this.session._id.toString();

    // If requestee is not the author: set message to read
    if(!author && !message.read) {
      database.messages().updateOne({"_id": message._id}, {"$set": {"read": true}});
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

  /* Function WebRequest.getNewMessages
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

  /* Function WebRequest.getMessages
   * Returns all messages that belong to a user in a session
   */

  database.getMessages(this.session._id, function(error, documents) {

    if(error) {
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    var userIdentifiers = documents.map(x => database.ObjectId(x.sender)).concat(documents.map(x => database.ObjectId(x.recipient)));

    // Get usernames from user identifiers
    database.getUsersById(userIdentifiers, function(error, users) {

      if(error) {
        return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
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

  ohttp.request("http://" + CONFIG.LATENCY.HOST + ":" + CONFIG.LATENCY.PORT + this.url.search, function(json) {
    this.writeJSON(JSON.parse(json));
  }.bind(this));

}

WebRequest.prototype.writeJSON = function(json) {

  /* Function WebRequest.writeJSON
   * Writes JSON to client
   */

  // Null when 204
  if(json === null) {
    return this.HTTPResponse(ohttp.S_HTTP_NO_CONTENT);
  }

  // This is bound to the response
  this.response.writeHead(ohttp.S_HTTP_OK, {"Content-Type": "application/json"});
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

  // If a network end is specified only show channels from before the network end time
  if(this.session.network.end !== null) {
    queryString.endtime = this.session.network.end.toISOString();
  }

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

WebRequest.prototype.getSubmittedFiles = function() {

  /* Function WebRequest.getSubmittedFiles
   * Abstracted function to read files from multiple directories
   * and concatenate the result
   */

  var networkQuery;

  // Submitted files with metadata
  if(this.session.role === "admin") {
    networkQuery = {"network.code": new RegExp(/.*/)}
  } else {
    networkQuery = {
      "network.code": this.session.network.code,
      "network.start": this.session.network.start,
      "network.end": this.session.network.end
    }
  }

  // Stages:
  // Pending -> Accepted | Rejected
  var pipeline = [{
    "$match": networkQuery
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
      },
      "error": {
        "$last": "$error"
      },
      "sha256": {
        "$last": "$sha256"
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
      return this.HTTPError(ohttp.E_HTTP_INTERNAL_SERVER_ERROR, error);
    }

    this.writeJSON(files);

  }.bind(this));

}

WebRequest.prototype.getFDSNWSStations = function() {

  /* Function WebRequest.GetFDSNWSStations
   * Returns station information from FDSNWS Station
   */

  // Query information for the session network
  var queryString = querystring.stringify({
    "level": "station",
    "format": "text",
    "network": this.session.network.code
  })

  // If the network end is specified only show stations from before the network end
  if(this.session.network.end !== null) {
    queryString.endtime = this.session.network.end.toISOString()
  }

  ohttp.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, function(json) {
    this.writeJSON(this.parseFDSNWSResponse(json));
  }.bind(this));

}

// Init the server
init();

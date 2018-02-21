// Native includes
const http = require("http");
const crypto = require("crypto");
const assert = require("assert");
const path = require("path");
const url = require("url");
const fs = require("fs");
const querystring = require("querystring");

// Libraries
const libxmljs = require("libxmljs");

// ORFEUS libs
const Database = require("./orfeus-database");
const Multipart = require("./multipart");
const Session = require("./orfeus-session");
const Console = require("./orfeus-logging");
const XSDSchema = require("./orfeus-xml");

const STATIC_FILES = require("./orfeus-static");
const CONFIG = require("./config");

const S_HTTP_OK = 200;
const S_HTTP_NO_CONTENT = 204;
const S_HTTP_REDIRECT = 301;
const E_HTTP_UNAUTHORIZED = 401;
const E_HTTP_FILE_NOT_FOUND = 404;
const E_HTTP_INTERNAL_SERVER_ERROR = 500;

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
  this.networks = user.networks;
  this.version = user.version;
  this.visited = user.visited;
  this.role = user.role;

  // Path where the user stores uploaded files
  this.filepath = path.join("files", user.username); 

}

function HTTPError(response, status) {

  response.writeHead(status, {"Content-Type": "text/html"});
  response.end(generateHTTPError(status));

}

function Redirect(response, path) {
  var headers = {"Location": path};
  response.writeHead(S_HTTP_REDIRECT, headers);
  response.end();
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

var Webserver = function() {

  /* Class Webserver
   * Opens NodeJS webservice on given PORT
   * Handles all incoming connections
   */

  // Create the HTTP server and listen to incoming requests
  var webserver = http.createServer(function(request, response) {
  
    // Prevent browser-side caching of sessions
    response.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

    // Parse the resource identifier
    const uri = url.parse(request.url).pathname;
    const search = url.parse(request.url).search;
    var nBytes = 0;

    // Monkey patch the response write function
    // To keep track of number of bytes shipped
    response.write = (function(closure) {

      return function(chunk) {

        // Update bytes written
        nBytes = nBytes + chunk.length;

        return closure.apply(this, arguments);

      }

    })(response.write);

    // Response finish write to log
    response.on("finish", function() {

      const clientIp = request.headers["x-forwarded-for"] || request.connection.remoteAddress || null;
      const userAgent = request.headers["user-agent"] || null

      Console.debug([clientIp, uri, request.method, response.statusCode, nBytes, userAgent].join(" "));

    });

    // Serve static file
    if(STATIC_FILES.indexOf(uri) !== -1) {
      switch(path.extname(uri)) {
        case ".css":
          response.writeHead(S_HTTP_OK, {"Content-Type": "text/css"});
          break
        case ".png":
          response.writeHead(S_HTTP_OK, {"Content-Type": "image/png"});
          break
        case ".js":
          response.writeHead(S_HTTP_OK, {"Content-Type": "application/javascript"});
          break;
      }
      return fs.createReadStream(path.join("static", uri)).pipe(response);
    }

    // Redirect webserver root to the login page
    if(uri === "/") {
      return Redirect(response, "/login");
    }

     /* 
      * An authenticated session may be required
      */

    getSession(request.headers, function(error, session) {
  
      // ORFEUS Manager log in page
      if(uri.startsWith("/login")) {
  
        // If the user is already logged in redirect to home page
        if(session !== null) {
          return Redirect(response, "/home");
        }
  
        // Get request is made on the login page
        response.writeHead(S_HTTP_OK, {"Content-Type": "text/html"});
        return response.end(generateLogin(request.url));
  
      }

      // When the database connection fails
      if(error) {
        return HTTPError(response, E_HTTP_INTERNAL_SERVER_ERROR);
      }
  
      // URL for posting messages
      if(uri === "/send") {

        // Parse the POSTed request body as JSON
        parseRequestBody(request, "json", function(postBody) {

          // Disallow message to be sent to self
          if(postBody.recipient === session.username) {
            return Redirect(response, "/home/messages/new?self");
          }

          // Admin may sign broadcasted message
          if(postBody.recipient === "BROADCAST" && session.role === "admin") {
            var userQuery = {"username": {"$not": {"$eq": session.username}}}
          } else {
            var userQuery = {"username": postBody.recipient}
          }

          // Query the user database for the recipient name
          Database.users().find(userQuery).toArray(function(error, users) {

            // Unknown recipient
            if(users.length === 0) {
              return Redirect(response, "/home/messages/new?unknown");
            }

            // Create a new message
            const messageBody = users.map(function(user) {
              return Message(
                user._id,
                session._id,
                escapeHTML(postBody.subject),
                escapeHTML(postBody.content)
              )
            });

            // Store all messages
            Database.messages().insertMany(messageBody, function(error, result) {

              // Error storing messages
              if(error) {
                return Redirect(response, "/home/messages/new?failure");
              }

              Redirect(response, "/home/messages/new?success");

            });

          });

        });

        return;

      }

      // Method for authentication
      if(uri === "/authenticate") {
  
        // If the user is already logged in redirect to home page
        if(session !== null) {
          return Redirect(response, "/home");
        }

        // Attempt to parse the POST body passed by the HTML form
        // Contains username and password
        parseRequestBody(request, "json", function(postBody) {
  
          // Check the user credentials
          Authenticate(postBody, function(valid, user) {
  
            // Authentication failed
            if(!valid) {
              return Redirect(response, "/login?invalid");
            }
  
            // Create a new session for the user
            createSession(user, function(cookie) {
  
              if(cookie === null) {
                return HTTPError(response, E_HTTP_INTERNAL_SERVER_ERROR);
              }

              // Redirect user to home page and set a cookie for this session
              response.writeHead(S_HTTP_REDIRECT, {
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
      if(session === null) {
        return HTTPError(response, E_HTTP_UNAUTHORIZED);
      }

      /* +-----------------------------------+
       * | PROTECTED AREA                    |
       * | REQUIRES AN AUTHENTICATED SESSION |
       * +-----------------------------------+
       */
  
      // Forward the request to the API
      if(uri.startsWith("/api")) {
        return APIRequest(request, response, session); 
      }
  
      // User wishes to log out
      if(uri === "/logout") {
  
        // Destroy the session
        Database.sessions().deleteOne({"SESSION_ID": session.sessionId}, function(error, result) {

          const STATUS_MESSAGE = "Removed session for " + session.username + " (" + session.sessionId + ")";

          error ? Console.error(STATUS_MESSAGE) : Console.info(STATUS_MESSAGE);

          Redirect(response, "/login?logout");

        });

        return;
  
      }
  
      // Profile page
      if(uri === "/home") {

        // Update the last visit & app. version
        if(search === "?welcome") {
          Database.users().updateOne({"_id": session._id}, {"$set": {"version": CONFIG.__VERSION__, "visited": new Date()}});
        }

        return response.end(generateProfile(session));

      }

      if(uri === "/home/messages") {
        return response.end(generateMessages(session));
      }

      if(uri === "/home/messages/new") {
        return response.end(sendNewMessage(request.url, session));
      }

      if(uri.startsWith("/home/messages/detail")) {
        return response.end(generateMessageDetails(session));
      }
   
      // Station details page
      if(uri === "/home/station") {
        return response.end(generateStationDetails(session));
      }

      if(uri === "/upload") {
  
        if(request.method !== "POST") {
          return response.end();
        }
  
        // Parse the POST body (binary file)
        parseRequestBody(request, "multiform", function(files) {

          // Only accept files with content 
          var files = files.filter(function(x) {
            return x.data.length !== 0;
          });

          // Write (multiple) files to disk
          writeMultipleFiles(files, session, function(error) {
            return Redirect(response, "/home?" + (error ? "failure" : "success")); 
          });
          
        });
  
        return;
  
      }

      response.writeHead(404, {"Content-Type": "text/html"});
      response.write(generate404());
      response.end();
  
    });
  
  });

  // Listen to incoming connections
  webserver.listen(CONFIG.PORT, CONFIG.HOST, function() {
    Console.info("Webserver started at " + CONFIG.HOST + ":" + CONFIG.PORT);
  });

  // Gracful shutdown of server
  process.on("SIGINT", function () {
    Console.info("SIGINT received: closing webserver");
    //webserver.close(function() {
      Console.info("Webserver has been closed");
      process.exit(0);
    //});
  });

}

function validateMetadata(XMLDocument) {

  /* function validateMetadata
   * Server side validation of StationXML metadata
   */

  const NETWORK_REGEXP = new RegExp(/^[a-z0-9]{1,2}$/i);
  const STATION_REGEXP = new RegExp(/^[a-z0-9]{1,5}$/i);
  const GAIN_TOLERNACE_PERCENT = 0.001;

  var namespace = XMLDocument.root().namespace().href();

  XMLDocument.find("xmlns:Network", namespace).forEach(function(network) {

    var networkCode = network.attr("code").value();

    // Confirm network & station identifiers
    if(!NETWORK_REGEXP.test(networkCode)) {
      throw("Invalid network code");
    }

    network.find("xmlns:Station", namespace).forEach(function(station) {

      var stationCode = station.attr("code").value();

      if(!STATION_REGEXP.test(stationCode)) {
        throw("Invalid station code");
      }

      var channels = station.find("xmlns:Channel", namespace);

      if(channels.length === 0) {
        throw("Channel information missing");
      }

      channels.forEach(function(channel) {

        var channelCode = channel.attr("code").value();

        var sampleRate = Number(channel.get("xmlns:SampleRate", namespace).text())

        if(isNaN(sampleRate) || sampleRate === 0) {
          throw("Invalid sample rate");
        }

        var response = channel.find("xmlns:Response", namespace);

        if(response.length === 0) {
          throw("Response element is missing");
        }

        if(response.length !== 1) {
          throw("Multiple response elements included");
        }

        var stages = response[0].find("xmlns:Stage", namespace);

        if(stages.length === 0) {
          throw("No response stages included in inventory");
        }

        var perStageGain = 1;

        stages.forEach(function(stage) {

          perStageGain = perStageGain * Number(stage.get("xmlns:StageGain", namespace).get("xmlns:Value", namespace).text());

          stage.find("xmlns:FIR", namespace).forEach(function(FIRStage) {
            validateFIRStage(FIRStage, namespace);
          });

        });

        var instrumentSensitivity = Number(response[0].get("xmlns:InstrumentSensitivity", namespace).get("xmlns:Value", namespace).text());

        // Validate stage calculated & reported gains
        if(1 - (Math.max(instrumentSensitivity, perStageGain) / Math.min(instrumentSensitivity, perStageGain)) > GAIN_TOLERNACE_PERCENT) {
          throw("Computed and reported stage gain is different");
        }

      });

    });

  });

}

function Sum(array) {

  /* function Sum
   * returns the average of an array
   */

  return array.reduce(function(a, b) {
    return a + b;
  }, 0);

}

function validateFIRStage(FIRStage, namespace) {

  /* function validateFIRStage
   * Validates StationXML FIR Stage
   */

  const FIR_TOLERANCE = 0.02;

  // Confirm FIR Stage input units as COUNTS
  if(FIRStage.get("xmlns:InputUnits", namespace).get("xmlns:Name", namespace).text() !== "COUNTS") {
    throw("FIR Stage input units invalid");
  }

  // Confirm FIR Stage output units as COUNTS
  if(FIRStage.get("xmlns:OutputUnits", namespace).get("xmlns:Name", namespace).text() !== "COUNTS") {
    throw("FIR Stage output units invalid");
  }

  var FIRSum = Sum(FIRStage.find("xmlns:NumeratorCoefficient", namespace).map(function(FIRCoefficient) {
    return Number(FIRCoefficient.text());
  }));

  // Symmetry specified: FIR coefficients are symmetrical (double the sum)
  if(FIRStage.get("xmlns:Symmetry", namespace).text() !== "NONE") {
    FIRSum = 2 * FIRSum;
  }

  // Check if the FIR coefficient sum is within tolerance
  if(Math.abs(1 - FIRSum) > FIR_TOLERANCE) {
    throw("Invalid FIR Coefficient Sum (" + Math.abs(1 - FIRSum).toFixed(4) + ")");
  }

}


function splitStationXML(files) {

  /* function splitStationXML
   * Validated and splits stationXML per station
   */

  const FDSN_SENDER = "ORFEUS";
  const FDSN_SOURCE = "ORFEUS Manager Upload";
  const FDSN_MODULE = "ORFEUS Manager " + CONFIG.__VERSION__;
  const FDSN_STATION_VERSION = "1.0";

  // Collection of documents to be written
  var XMLDocuments = new Array();

  for(var i = 0; i < files.length; i++) {

    // Convert to libxmljs object
    var XMLDocument = libxmljs.parseXml(files[i].data);

    // Validate the entire against the schema
    if(!XMLDocument.validate(XSDSchema)) {
      throw("Error validating FDSNStationXML");
    }

    validateMetadata(XMLDocument);

    // Get the namespace & schema version of document
    var namespace = XMLDocument.root().namespace().href();
    var schemaVersion = XMLDocument.root().attr("schemaVersion").value();

    // Confirm version
    if(schemaVersion !== FDSN_STATION_VERSION) {
      throw("Invalid FDSNStationXML version");
    }

    // Split entries by Network / Station
    XMLDocument.find("xmlns:Network", namespace).forEach(function(network) {

      var networkCode = network.attr("code").value();

      network.find("xmlns:Station", namespace).forEach(function(station) {

        var stationCode = station.attr("code").value();

        Console.debug("Extracting station " + networkCode + "." + stationCode + " from document");

        // Namespace must be removed this way (known bug in libxmljs)
        // And then replaced out in the string representation
        station.namespace("");

        // Create a new XML document
        var stationXMLDocument = new libxmljs.Document("1.0", "UTF-8");

        // Add FDSNStationXML attributes
        var stationXMLRoot = stationXMLDocument.node("FDSNStationXML").attr({
          "xmlns": namespace,
          "schemaVersion": schemaVersion
        });

        // Add new properties to the root
        stationXMLRoot.node("Source", FDSN_SOURCE);
        stationXMLRoot.node("Sender", FDSN_SENDER);
        stationXMLRoot.node("Module", FDSN_MODULE);
        stationXMLRoot.node("Created", new Date().toISOString());

        stationXMLNetwork = stationXMLRoot.node("Network");

        // Add child nodes that are not "Station" or "text" (e.g. description)
        network.childNodes().forEach(function(x) {
          if(x.name() !== "Station" && x.name() !== "text") {
            stationXMLNetwork.node(x.name(), x.text());
          }
        });

        // Collect the attributes
        var attrs = new Object();
        network.attrs().forEach(function(x) {
          attrs[x.name()] = x.value();
        });

        // Set the attributes
        stationXMLNetwork.attr(attrs);

        // Add particular station
        stationXMLNetwork.addChild(station);

        // Validate the entire against the schema
        var XMLString = stationXMLDocument.toString().replace(" xmlns=\"\"", "");

        // Validate the extracted document against the schema (only during DEBUG)
        if(CONFIG.__DEBUG__ && !libxmljs.parseXml(XMLString).validate(XSDSchema)) {
          throw("Extracted document does not validate.");
        }

        XMLDocuments.push({
          "data": XMLString,
          "metadata": {
            "network": networkCode,
            "station": stationCode,
            "filepath": path.join("files", networkCode, stationCode),
            "id": networkCode + "." + stationCode,
            "size": XMLString.length,
            "sha256": SHA256(XMLString)
          }
        });

      });

    });
  
  }

  return XMLDocuments;

}

function createDirectory(filepath) {

  /* function createDirectory
   * Creates a directory for filepath if it does not exist
   */

  if(fs.existsSync(filepath)) {
    return;
  }

  var dirname = path.dirname(filepath);

  if(!fs.existsSync(dirname)) {
    createDirectory(dirname);
  }

  Console.debug("Creating directory " + filepath);

  fs.mkdirSync(filepath);

}

function writeMultipleFiles(files, session, callback) {

  /* function writeMultipleFiles
   * Writes multiple (split) StationXML files to disk
   */

  // We split any submitted StationXML files
  try {
    var XMLDocuments = splitStationXML(files);
  } catch(exception) {
    return callback(exception);
  }

  // Confirm user is manager of the network
  for(var i = 0; i < XMLDocuments.length; i++) {
    if(session.networks.indexOf(XMLDocuments[i].metadata.network) === -1) {
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

  // Asynchronous writing for multiple files to disk
  (writeFile = function() {

    var file = XMLDocuments.pop();

    var STATUS_MESSAGE = "Writing file " + file.metadata.sha256 + " (" + file.metadata.id + ") to disk";

    // NodeJS std lib for writing file
    fs.writeFile(path.join(file.metadata.filepath, file.metadata.sha256), file.data, function(error) {

      // Write to log
      error ? Console.error(STATUS_MESSAGE) : Console.info(STATUS_MESSAGE);

      if(error) {
        return callback(error);
      }

      if(XMLDocuments.length === 0) {
        return callback(null)
      }

      // More files to write
      writeFile();
      
    });

  })();

}

function generateHTTPError(status) {

  // Unknown status code
  if(!http.STATUS_CODES.hasOwnProperty(status)) {
    status = 418;
  }

  return [
    generateHeader(),
    "  <body>",
    "    <div class='container'>",
    "      <h2 class='text-muted'><span style='color: #C03;'>" + status +"</span> " + http.STATUS_CODES[status] + " </h2>",
    "    </div>",
    "  </body>",
    generateFooter(),
    "</html>"
  ].join("\n");

}

function getAdministrators(callback) {

  /* function getAdministrators
   * Returns documents for all administrators
   */
 
  Database.users().find({"role": "admin"}).toArray(function(error, users) {

    if(error || users.length === 0) {
      return callback(null);
    }

    callback(users)

  });

}

function saveFilesObjects(metadata, session) {

  // Store file information in the database
  var dbFiles = metadata.map(function(x) {
    return {
      "filename": x.id,
      "network": x.network,
      "station": x.station,
      "filepath": x.filepath,
      "type": "FDSNStationXML",
      "size": x.size,
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

var Message = function(recipient, sender, subject, content) {

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

    if(users === null) {
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
        return file.id;
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

function APIRequest(request, response, session) {

    /* Fuction APIRequest
     * All requests to the ORFEUS API go through here
     */

    // Parse the resource identifier
    var uri = url.parse(request.url);

    if(uri.pathname.startsWith("/api/latency")) {
      GetStationLatency(session, function(data) {
        response.end(data);
      });
      return;
    }

    // Stations managed by the session
    if(uri.pathname === "/api/stations") {
      GetFDSNWSStations(session, function(data) {
        response.end(ParseFDSNWSResponse(data));
      });
      return;
    }

    if(uri.pathname.startsWith("/api/messages/details")) {
      if(uri.search !== null && uri.search.startsWith("?read")) {
        GetSpecificMessage(session, url.parse(request.url), function(json) {
          response.end(JSON.stringify(json));
        });
      } else if(uri.search !== null && uri.search.startsWith("?delete")) {
        RemoveSpecificMessage(session, url.parse(request.url), function(json) {
          response.end(json);
        });
      } else {
        response.end(JSON.stringify(null));
      }
      return;
    }

    if(uri.pathname.startsWith("/api/messages")) {
      if(uri.search && uri.search.startsWith("?new")) {
        GetNewMessages(session, function(json) {
          response.end(json);
        });
      } else if(uri.search && uri.search.startsWith("?deleteall")) {
        RemoveAllMessages(session, function(json) {
          response.end(json);
        });
      } else if(uri.search && uri.search.startsWith("?deletesent")) {
        RemoveAllMessagesSent(session, function(json) {
          response.end(json);
        });
      } else {
        GetMessages(session, function(json) {
          response.end(json);
        });
      }
      return;
    }

    if(uri.pathname.startsWith("/api/channels")) {
      GetFDSNWSChannels(session, url.parse(request.url), function(data) {
        response.end(ParseFDSNWSResponseChannel(data));
      });
      return;
    }

    return HTTPError(E_HTTP_FILE_NOT_FOUND, response);

}

function RemoveAllMessagesSent(session, callback) {

  /* function RemoveAllMessages
   * Sets all messages for user to deleted
   */
  var query = {
    "sender": Database.ObjectId(session._id),
    "senderDeleted": false
  }

  // Get specific message from the database
  Database.messages().updateMany(query, {"$set": {"senderDeleted": true}}, function(error, messages) {
    callback(JSON.stringify(messages));
  });

}

function RemoveAllMessages(session, callback) {

  /* function RemoveAllMessages
   * Sets all messages for user to deleted
   */
  var query = {
    "recipient": Database.ObjectId(session._id),
    "recipientDeleted": false
  }

  // Get specific message from the database
  Database.messages().updateMany(query, {"$set": {"recipientDeleted": true}}, function(error, messages) {
    callback(JSON.stringify(messages));
  });

}

function RemoveSpecificMessage(session, request, callback) {

  /* function RemoveSpecificMessage
   * Sets message with particular id to deleted
   */

  // Get the message identifier from the query string
  var qs = querystring.parse(request.query);

  var senderQuery = {
    "sender": Database.ObjectId(session._id),
    "senderDeleted": false,
    "_id": Database.ObjectId(qs.delete)
  }

  var recipientQuery = {
    "recipient": Database.ObjectId(session._id),
    "recipientDeleted": false,
    "_id": Database.ObjectId(qs.delete)
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

function GetSpecificMessage(session, request, callback) {

  /* function GetSpecificMessage
   * Returns a specific private message
   */

  var qs = querystring.parse(request.query);

  // Get messages as sender or recipient (undeleted)
  var query = {
    "$or": [{
      "recipient": Database.ObjectId(session._id),
      "recipientDeleted": false
    }, {
      "sender": Database.ObjectId(session._id),
      "senderDeleted": false
    }],
    "_id": Database.ObjectId(qs.read)
  }

  // Get specific message from the database
  Database.messages().findOne(query, function(error, message) {

    if(error || message === null) {
      Console.error("Error getting single message from database.");
      return callback(null);
    }

    var author = message.sender.toString() === session._id.toString();

    // Set message to read
    if(!author) {
      Database.messages().updateOne(query, {"$set": {"read": true}});
    }

    var id = !author ? message.sender : message.recipient;

    // Find the username for the message sender 
    Database.users().findOne({"_id": Database.ObjectId(id)}, function(error, user) {

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

function GetNewMessages(session, callback) {

  /* function GetNewMessages
   * Return 
   */

  var query = {
    "recipient": Database.ObjectId(session._id),
    "read": false,
    "recipientDeleted": false
  }

  Database.messages().find(query).count(function(error, count) {
    callback(JSON.stringify({"count": count}));
  });

}

function GetMessages(session, callback) {

  /* function GetMessages
   * Returns all messages that belong to a user in a session
   */

  const query = {
    "$or": [{
      "recipient": Database.ObjectId(session._id),
      "recipientDeleted": false
    }, {
      "sender": Database.ObjectId(session._id),
      "senderDeleted": false
    }]
  }

  // Query the database for all messages
  Database.messages().find(query).sort({"created": -1}).toArray(function(error, documents) {

    if(error) {
      Console.error("Error getting messages from database.");
    }

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
        Console.error("Error getting users from database.");
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
          "author": x.sender.toString() === session._id.toString()
        }
      });
      
      callback(JSON.stringify(messageContents));

    });

  });

}

function GetStationLatency(session, callback) {

  var queryString = querystring.stringify({
    "network": session.networks.join(",")
  });

  var request = http.get(CONFIG.LATENCY_URL + "?" + queryString, function(response) {

    // Response was 204 No Content
    if(response.statusCode === S_HTTP_NO_CONTENT) {
      return callback(null);
    }

    var chunks = new Array();

    // Data chunk received
    response.on("data", function(chunk) {
      chunks.push(chunk);
    });

    // HTTP Get request ended
    response.on("end", function() {

      // HTTP Error code
      if(response.statusCode !== S_HTTP_OK) {
        return callback(null);
      }

      return callback(Buffer.concat(chunks).toString());

    });

  });

  // There was an error with the request (e.g. ECONNREFUSED)
  request.on("error", function(error) {
    return callback(null);
  });

}


function GetFDSNWSChannels(session, uri, callback) {

  const FDSNWS_STATION_URL = "http://www.orfeus-eu.org/fdsnws/station/1/query";

  // Hoist this
  var queryString = querystring.stringify({
    "level": "channel",
    "format": "text",
  });

  queryString += "&" + uri.query;

  HTTPRequest(FDSNWS_STATION_URL + "?" + queryString, callback);

}

function ParseFDSNWSResponseChannel(data) {

  // Run through the response and convert to JSON
  return JSON.stringify(data.split("\n").slice(1, -1).map(function(x) {
    var codes = x.split("|");
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
      "gain": codes[11],
      "sensorUnits": codes[13],
      "sampleRate": codes[14],
      "start": codes[15],
      "end": codes[16]
    }
  }));

}

function ParseFDSNWSResponse(data) {

  /* Function ParseFDSNWSResponse
   * Returns parsed JSON response from FDSNWS Station
   */

  if(data === null) {
    return JSON.stringify(new Array());
  }

  // Run through the response and convert to JSON
  return JSON.stringify(data.split("\n").slice(1, -1).map(function(x) {
    var codes = x.split("|");
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
  }));

}

function HTTPRequest(url, callback) {

  /* function HTTPRequest
   * Makes HTTP Get request to url and fires callback on completion
   */

  // Open HTTP GET request
  var request = http.get(url, function(response) {

    // Response was 204 No Content
    if(response.statusCode === S_HTTP_NO_CONTENT) {
      return callback(null);
    }

    var chunks = new Array();

    // Data chunk received
    response.on("data", function(chunk) {
      chunks.push(chunk);
    });

    // HTTP Get request ended
    response.on("end", function() {

      if(response.statusCode !== S_HTTP_OK) {
        return callback(null);
      }

      return callback(Buffer.concat(chunks).toString());

    });

  });

  // There was an error with the request (e.g. ECONNREFUSED)
  request.on("error", function(error) {
    return callback(null);
  });

}

function GetFDSNWSStations(session, callback) {

  /* Function GetFDSNWSStations
   * Returns station information from FDSNWS Station
   */

  const FDSNWS_STATION_URL = "http://www.orfeus-eu.org/fdsnws/station/1/query";

  // Hoist this
  var queryString = querystring.stringify({
    "level": "station",
    "format": "text",
    "network": session.networks.join(",")
  });

  HTTPRequest(FDSNWS_STATION_URL + "?" + queryString, callback);

}

function SHA256(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function Authenticate(postBody, callback) {

  Database.users().findOne({"username": postBody.username}, function(error, result) {

    // Username or password is invalid
    if(error || result === null) {
      return callback(false);
    }

    // Confirm the user password
    if(result.password === SHA256(postBody.password + result.salt)) {
      return callback(true, result);
    } else {
      return callback(false);
    }

  });

}

function generateHeader() {

  /*
   *
   */
  return [
    "<!DOCTYPE html>",
    "<html lang='en'>",
    "  <head>",
    "    <meta charset='utf-8'>",
    "    <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>",
    "    <meta name='description' content='ORFEUS Manager'>",
    "    <meta name='author' content='ORFEUS Data Center'>",
    "    <title>ORFEUS Manager</title>",
    "    <link rel='stylesheet' href='/css/style.css'>",
    "  </head>",
  ].join("\n");

}

function generateInvalid(invalid) {

  if(invalid.endsWith("invalid")) {
    return [
      "        <div class='alert alert-danger'>",
      "          <span class='fa fa-remove aria-hidden='true'></span>",
      "          Invalid credentials.",
      "        </div>"
    ].join("\n");
  } else if(invalid.endsWith("logout")) {
    return [
      "        <div class='alert alert-success'>",
      "          <span class='fa fa-check aria-hidden='true'></span>",
      "          Succesfully logged out.",
      "        </div>"
    ].join("\n");
  }

  return null;

}

function generateLogin(invalid) {

  return [
    generateHeader(),
    "  <body>",
    "    <div class='container'>",
    "      <form class='form-signin' method='post' action='authenticate'>",
    "        <h2 class='form-signin-heading'><span style='color: #C03;'>O</span>RFEUS Manager</h2>",
    "        <div class='input-group'>",
    "          <span class='input-group-addon'><span class='fa fa-user-circle-o' aria-hidden='true'></span></span>",
    "          <input name='username' class='form-control' placeholder='Username' required autofocus>",
    "        </div>",
    "        <div class='input-group'>",
    "          <span class='input-group-addon'><span class='fa fa-key' aria-hidden='true'></span></span>",
    "          <input name='password' type='password' class='form-control' placeholder='Password' required>",
    "        </div>",
    "        <hr>",
    generateInvalid(invalid),
    "        <button class='btn btn-lg btn-primary btn-block' type='submit'><span class='fa fa-lock' aria-hidden='true'></span> Authenticate</button>",
    "      </form>",
    "    </div>",
    "  </body>",
    generateFooter(),
    "</html>"
  ].join("\n");

}

function generateFooterApp() {

  return [
    "  <script src='https://code.highcharts.com/highcharts.js'></script>",
    "  <script src='https://cdn.socket.io/socket.io-1.4.5.js'></script>",
    "  <script src='https://maps.googleapis.com/maps/api/js?key=AIzaSyAN3tYdvQ5tSS5NIKwZX-ZqhsM4NApVV_I'></script>",
    "  <script src='/js/table.js'></script>",
    "  <script src='/js/app.js'></script>",
  ].join("\n");

}

function generateFooter() {

  return [
    "  <div class='modal fade' id='modal-alert' tabindex='-1' role='dialog' aria-labelledby='exampleModalCenterTitle' aria-hidden='true'>",
    "    <div class='modal-dialog h-100 d-flex flex-column justify-content-center my-0' role='document'>",
    "      <div class='modal-content'>",
    "        <div class='modal-header'>",
    "          <h4 class='modal-title' id='modal-title'><span class='text-danger'>O</span>RFEUS Manager</h4>",
    "          <button type='button' class='close' data-dismiss='modal' aria-label='Close'>",
    "            <span aria-hidden='true'>&times;</span>",
    "          </button>",
    "        </div>",
    "        <div id='modal-content' class='modal-body' style='text-align: center;'></div>",
    "      </div>",
    "    </div>",
    "  </div>",
    "  <footer class='container text-muted'>",
    "  <hr>",
    "  ORFEUS Manager &copy; ODC " + new Date().getFullYear() + ". All Rights Reserved.",
    "  <div style='float: right;'><small>Version v" + CONFIG.__VERSION__ + "</small></div>",
    "  </footer>",
    "  <link rel='stylesheet' href='https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css'>",
    "  <link rel='stylesheet' href='https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-alpha.6/css/bootstrap.min.css' integrity='sha384-rwoIResjU2yc3z8GV/NPeZWAv56rSmLldC3R/AZzGRnGxQQKnKkoFVhFQhNUwEyJ' crossorigin='anonymous'>",
    "  <script src='https://code.jquery.com/jquery-3.1.1.min.js' integrity='sha384-A7FZj7v+d/sdmMqp/nOQwliLvUsJfDHW+k9Omg/a/EheAdgtzNs3hpfag6Ed950n' crossorigin='anonymous'></script>",
    "  <script src='https://cdnjs.cloudflare.com/ajax/libs/tether/1.4.0/js/tether.min.js' integrity='sha384-DztdAPBWPRXSA/3eYEEUWrWCy7G5KFbe8fFjk5JAIxUYHKkDx6Qin1DkWx51bBrb' crossorigin='anonymous'></script>",
    "  <script src='https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-alpha.6/js/bootstrap.min.js' integrity='sha384-vBWWzlZJ8ea9aCX4pEW3rVHjgjt7zpkNpZk+02D9phzyeVkE+jo0ieGizqPLForn' crossorigin='anonymous'></script>",
  ].join("\n");

}

function generateMessageDetails(session) {

  return [
    generateHeader(),
    generateWelcome(session),
    "    <div class='container'>",
    "      <div id='message-detail'></div>",
    "    </div>",
    generateFooter(),
    generateFooterApp()
  ].join("\n");

}

function generateMessages(session) {

  /* function generateMessages
   * Template for private message inbox
   */

  return [
    generateHeader(),
    generateWelcome(session),
    "    <div class='container'>",
    "      <div style='text-align: right;'>",
    "        <a class='btn btn-success btn-sm' href='/home/messages/new'><span class='fa fa-plus-square'></span> New Message</a>",
    "      </div>",
    "      <br>",
    "      <ul class='nav nav-tabs nav-justified' role='tablist'>",
    "        <li class='nav-item'>",
    "          <a class='nav-link active' role='tab' data-toggle='tab' href='#messages-inbox-tab'><span class='fa fa-envelope-o' aria-hidden='true'></span> &nbsp; Message Inbox</a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#messages-sent-tab'><span class='fa fa-location-arrow' aria-hidden='true'></span> &nbsp; Sent Messages</a>",
    "        </li>",
    "      </ul>",
    "      <div class='tab-content'>",
    "        <div class='tab-pane active' id='messages-inbox-tab' role='tabpanel'>",
    "          <div id='message-content'></div>",
    "          <div style='text-align: right;'>",
    "            <button onClick='deleteAllMessages(\"inbox\")' class='btn btn-danger btn-sm' id='delete-all-messages'><span class='fa fa-minus-square'></span> &nbsp; Delete All</button>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='messages-sent-tab' role='tabpanel'>",
    "          <div id='message-content-sent'></div>",
    "          <div style='text-align: right;'>",
    "            <button onClick='deleteAllMessages(\"sent\")' class='btn btn-danger btn-sm' id='delete-all-messages'><span class='fa fa-minus-square'></span> &nbsp; Delete All</button>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    generateFooter(),
    generateFooterApp()
  ].join("\n");

}

function sendNewMessage(invalid, session) {

  return [
    generateHeader(),
    generateWelcome(session),
    "      <form class='message-form' method='post' action='/send'>",
    "        <div id='message-information'></div>",
    "        <h3>Submit new message</h3>",
    "        <div class='input-group'>",
    "          <span class='input-group-addon'><span class='fa fa-pencil' aria-hidden='true'> Subject</span></span>",
    "          <input name='subject' class='form-control' placeholder='Subject' required autofocus>",
    "          <span class='input-group-addon'><span class='fa fa-user-circle-o' aria-hidden='true'> Recipient</span></span>",
    "          <input name='recipient' class='form-control' placeholder='Recipient' required>",
    "        </div>",
    "        <div class='input-group'>",
    "          <textarea class='form-control' name='content' class='form-control' placeholder='Message'></textarea>",
    "        </div>",
    "        <hr>",
    "        <button class='btn btn-lg btn-primary btn-block' type='submit'><span class='fa fa-location-arrow' aria-hidden='true'></span> Send</button>",
    "      </form>",
    generateFooter(),
    generateFooterApp()
  ].join("\n");

}

function generateStationDetails(session) {

  return [
    generateHeader(),
    generateWelcome(session),
    "  <body>",
    "    <div class='container'>",
    "      <div class='row'>",
    "        <div class='col'>",
    "          <div id='map'></div>",
    "            <div class='card'>",
    "              <div class='card-header'>",
    "                <div id='map-information'></div>",
    "              </div>",
    "              <div class='card-block'>",
    "<h4><span class='fa fa-heart-o text-danger' aria-hidden='true'></span> Seedlink Health</h4>",
    "                <div id='channel-information-latency'></div>",
    "              </div>",
    "            </div>",
    "        </div>",
    "        <div class='col'>",
    "          <h4><span id='channel-information-header'></span> Channel Information</h4>",
    "          <hr>",
    "          <div class='form-check alert alert-info'>",
    "            <label class='form-check-label'>",
    "              <input id='hide-channels' class='form-check-input' type='checkbox' value=''> Show Closed Channels",
    "            </label>",
    "            &nbsp;",
    "            <label class='form-check-label'>",
    "              <input id='connect-seedlink' class='form-check-input' type='checkbox' value=''> Connect to Seedlink",
    "            </label>",
    "          </div>",
    "          <div id='channel-information'></div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "    <div id='station-detail-header'></div>",
    "  </body>",
    generateFooter(),
    generateFooterApp(),
    "<html>"
  ].join("\n");

}


function generateWelcome(session) {

  return [
    "    <script>const USER_NETWORKS = " + JSON.stringify(session.networks) + "; USER_VERSION = " + JSON.stringify(session.version) + "</script>",
    "    <div class='container'>",
    "      <div style='float: right;'>",
    "        <a href='/home/messages'><span class='badge badge-success'><span class='fa fa-envelope' aria-hidden='true'></span> <small><span id='number-messages'></span></small></span></a>",
    "        &nbsp;",
    "        <a href='/logout'><span class='fa fa-sign-out' aria-hidden='true'></span><small>Logout</small></a>",
    "      </div>",
    "      <h2 class='form-signin-heading'><span style='color: #C03;'>O</span>RFEUS Manager <small class='text-muted'>" + CONFIG.NODE.ID + "</small></h2>",
    generateWelcomeInformation(session),
    "      <div id='breadcrumb-container'></div>",
    "      <hr>",
  ].join("\n");

}

function generateWelcomeInformation(session) {

  /* function generateWelcomeInformation
   * template for top session banner
   */

  return [
    "      <div class='alert alert-warning'>",
    "        <div style='float: right;'>",
    "          <small>",
    "            Last visit at <span class='fa fa-clock-o'></span> <b>" + session.visited.toISOString() + "</b>",
    "          </small>",
    "        </div>",
    "        <h3>",
    "          <span class='fa fa-user-" + (session.role === "admin" ? "circle text-danger" : "circle") + "' aria-hidden='true'></span> " + session.username + " <small class='text-muted'><span id='doi-link'></span></small>",
    "        </h3>",
    "      </div>",
  ].join("\n");

}

function generateProfile(session) {

  return [
    generateHeader(),
    generateWelcome(session),
    "      <ul class='nav nav-tabs nav-justified' role='tablist'>",
    "        <li class='nav-item'>",
    "          <a class='nav-link active' role='tab' data-toggle='tab' href='#map-container-tab'><span class='fa fa-map' aria-hidden='true'></span> &nbsp; Map Display</a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#table-container-tab'><span class='fa fa-table' aria-hidden='true'></span> &nbsp; Tabular Display</a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#settings-container-tab'><span class='fa fa-cog' aria-hidden='true'></span> &nbsp; Metadata</a>",
    "        </li>",
    "      </ul>",
    "      <div class='tab-content'>",
    "        <div class='tab-pane active' id='map-container-tab' role='tabpanel'>",
    "          <div class='map-container'>",
    "            <div id='map'></div>",
    "            <div class='card'>",
    "              <div class='card-header'>",
    "                <div style='float: right;'>",
    "                  <button class='btn btn-link' onClick='downloadKML()'><span class='fa fa-sign-out' aria-hidden='true'></span> <small>Download KML</small></button>",
    "                </div>",
    "                <div id='map-information'></div>",
    "              </div>",
    "            </div>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='table-container-tab' role='tabpanel'>",
    "          <div id='table-container'></div>",
    "          <hr>",
    "          <div class='card'>",
    "            <div class='card-header'>",
    "              <div style='float: right;'>",
    "                <button class='btn btn-link' onClick='downloadTable()'><span class='fa fa-sign-out' aria-hidden='true'></span> <small>Download JSON</small></button>",
    "              </div>",
    "              <div id='table-information'></div>",
    "            </div>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='settings-container-tab' role='tabpanel'>",
    "          <h3> Metadata Management </h3>",
    "          <p> Use this form to submit new station metadata to your ORFEUS data center.",
    "          <form class='form-inline' method='post' action='upload' enctype='multipart/form-data'>",
    "            <label class='custom-file'>",
    "              <input id='file-stage' name='file-data' type='file' class='form-control-file' aria-describedby='fileHelp' required multiple>",
    "              <span class='custom-file-control'></span>",
    "            </label>",
    "            &nbsp; <input id='file-submit' class='btn btn-success' type='submit' value='Send' disabled>",
    "          </form>",
    "          <small id='file-help' class='form-text text-muted'></small>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  </body>",
    generateFooter(),
    generateFooterApp(),
    "<html>"
  ].join("\n");

}

function parseRequestBody(request, type, callback) {

  /* function parseRequestBody
   * parses postBody
   */

  var chunks = new Array();

  // Data received from client
  request.on("data", function(chunk) {
    chunks.push(chunk);
  });

  // Request has been ended by client
  request.on("end", function() {

    var fullBuffer = Buffer.concat(chunks);

    // Support for different types of data
    switch(type) {
      case "multiform":
        return callback(parseMultiform(fullBuffer, request.headers));
      case "json":
        return callback(querystring.parse(fullBuffer.toString()));
    }

  });

}

function parseMultiform(buffer, headers) {

  var boundary = querystring.parse(headers["content-type"])["multipart/form-data; boundary"];

  return Multipart.Parse(buffer, boundary);
}

function escapeHTML(string) {

  /* function escapeHTML
   * Escapes HTML in user provided content
   */

  const entityMap = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
    "/": "&#x2F;",
    "`": "&#x60;",
    "=": "&#x3D;"
  };

  return String(string).replace(/[&<>"'`=\/]/g, function(character) {
    return entityMap[character];
  });

}

Init();

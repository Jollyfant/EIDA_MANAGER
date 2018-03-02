// Native includes
const {createServer} = require("http");
const path = require("path");
const dns = require("dns");
const url = require("url");
const fs = require("fs");
const querystring = require("querystring");

const multipart = require("./lib/multipart");

// ORFEUS libs
const Database = require("./lib/orfeus-database");
const Session = require("./lib/orfeus-session");
const Console = require("./lib/orfeus-logging");
const SHA256 = require("./lib/orfeus-crypto.js");
const OHTTP = require("./lib/orfeus-http.js");
const Template = require("./lib/orfeus-template.js");
const STATIC_FILES = require("./lib/orfeus-static");
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

function HTTPError(response, status) {

  response.writeHead(status, {"Content-Type": "text/html"});
  response.end(Template.generateHTTPError(status));

}

function Redirect(response, path) {
  var headers = {"Location": path};
  response.writeHead(OHTTP.S_HTTP_REDIRECT, headers);
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

  // Call the metaDaemon
  if(CONFIG.METADATA.DAEMON.ENABLED) {
    require("./lib/orfeus-metadaemon.js");
  }

  // Create the HTTP server and listen to incoming requests
  var webserver = createServer(function(request, response) {
  
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
          response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "text/css"});
          break
        case ".png":
          response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "image/png"});
          break
        case ".js":
          response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "application/javascript"});
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
        response.writeHead(OHTTP.S_HTTP_OK, {"Content-Type": "text/html"});
        return response.end(Template.generateLogin(request.url));
  
      }

      // When the database connection fails
      if(error) {
        return HTTPError(response, OTTHP.E_HTTP_INTERNAL_SERVER_ERROR);
      }

      if(CONFIG.__CLOSED__) {
        return HTTPError(response, OHTTP.E_HTTP_UNAVAILABLE);
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
          if(postBody.recipient === "broadcast" && session.role === "admin") {
            var userQuery = {"username": {"$not": {"$eq": session.username}}}
          } else if(postBody.recipient === "administrators") {
            var userQuery = {"role": "admin", "username": {"$not": {"$eq": session.username}}}
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
                return HTTPError(response, OHTTP.E_HTTP_INTERNAL_SERVER_ERROR);
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
      if(session === null) {
        return HTTPError(response, OHTTP.E_HTTP_UNAUTHORIZED);
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

        return response.end(Template.generateProfile(session));

      }

      if(uri === "/home/messages") {
        return response.end(Template.generateMessages(session));
      }

      if(uri === "/home/messages/new") {
        return response.end(Template.generateNewMessageTemplate(request.url, session));
      }

      if(uri.startsWith("/home/messages/detail")) {
        return response.end(Template.generateMessageDetails(session));
      }
   
      // Station details page
      if(uri === "/home/station") {
        return response.end(Template.generateStationDetails(session));
      }

      if(uri === "/seedlink") {

        if(request.method !== "POST") {
          return response.end();
        }

        parseRequestBody(request, "json", function(json) {

          const IPV4_ADDRESS_REGEX  = new RegExp("^(([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])\.){3}([0-9]|[1-9][0-9]|1[0-9]{2}|2[0-4][0-9]|25[0-5])$");
          const HOSTNAME_REGEX = new RegExp("^(([a-zA-Z0-9]|[a-zA-Z0-9][a-zA-Z0-9\-]*[a-zA-Z0-9])\.)*([A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9\-]*[A-Za-z0-9])$");

          const port = Number(json.port);

          // Confirm hostname or IPv4
          if(!IPV4_ADDRESS_REGEX.test(json.host) && !HOSTNAME_REGEX.test(json.host)) {
            return Redirect(response, "/home?failure");
          }

          // Accept ports between 0x0400 and 0xFFFF
          if(isNaN(port) || port < (1 << 10) || port > (1 << 16)) {
            return Redirect(response, "/home?failure");
          }

          // Store new seedlink object in database
          var storeObject = {
            "userId": session._id,
            "host": json.host,
            "port": Number(json.port),
            "created": new Date()
          }

          Database.seedlink().insertOne(storeObject, function(error, result) {
            return Redirect(response, "/home?" + (error ? "failure" : "s_success"));
          });
 
        });

        return;

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

            if(error) {
              Console.error(error);
            }

            return Redirect(response, "/home?" + (error ? "failure" : "success")); 

          });
          
        });
  
        return;
  
      }

      return HTTPError(response, OHTTP.E_HTTP_FILE_NOT_FOUND);
  
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
    GetStationLatency(uri, function(data) {
      response.end(data);
    });
    return;
  }

  if(uri.pathname === "/api/seedlink") {
    GetSeedlinkServers(session, function(data) {
      response.end(data);
    });
    return;
  }

  // Get the staged files
  if(uri.pathname === "/api/staged") {
    getSubmittedFiles(session, function(data) {
      response.end(JSON.stringify(data));
    });
    return;
  }

  // Stations managed by the session
  if(uri.pathname === "/api/stations") {
    GetFDSNWSStations(session, function(data) {
      response.end(JSON.stringify(ParseFDSNWSResponse(data)));
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

  return HTTPError(response, E_HTTP_FILE_NOT_FOUND);

}

function GetDNS(hosts, callback) {

  /* function GetDNS
   * Asynchronously gets DNS for multiple hosts
   * and fires callback on completion
   */

  var host, DNSQuery, DNSTimer;
  var DNSRecords = new Array();

  (DNSQuery = function() {

    // Set the timer
    DNSTimer = Date.now();

    // Get the next host
    host = hosts.pop();

    // Asynchronous lookup
    dns.lookup(host, function(error, IPAddress) {

      Console.debug("DNS lookup to " + host + " completed in " + (Date.now() - DNSTimer) + "ms (" + (IPAddress || error.code) + ")");

      DNSRecords.push({
        "ip": IPAddress || error.code,
        "host": host
      });

      // Continue with next lookup
      if(hosts.length) {
        return DNSQuery();
      }

      callback(DNSRecords);

    });

  })();

}

function GetSeedlinkServers(session, callback) {

  Database.seedlink().find({"userId": session._id}).toArray(function(error, results) {

    if(error || results.length === 0) {
      return JSON.stringify(new Array());
    }

    var servers = results.map(function(x) {
      return x.host;
    })

    // Query the DNS records
    GetDNS(servers, function(DNSRecords) {

      var servers = DNSRecords.map(function(x) {
        return x.host
      }).join(",");

      var hashMap = new Object();
      DNSRecords.forEach(function(x) {
        hashMap[x.host] = x.ip;
      });

      OHTTP.request(CONFIG.SEEDLINK.STATION.HOST + ":" + CONFIG.SEEDLINK.STATION.PORT + "?host=" + servers, function(data) { 

        if(!data) {
          return callback(JSON.stringify(results));
        }

        data = JSON.parse(data);

        results.forEach(function(x) {
          for(var i = 0; i < data.length; i++) {
            if(data[i].host === x.host) {
              x.ip = hashMap[x.host];
              x.identifier = data[i].identifier;
              x.connected = data[i].connected;
              x.version = data[i].version;
              x.stations = data[i].stations.filter(function(station) {
                return station.network === session.network;
              });

            }
          } 
        });

        callback(JSON.stringify(results));

      });

    });

  });

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

function GetStationLatency(uri, callback) {

  OHTTP.request(CONFIG.LATENCY_URL + uri.search, callback);

}


function GetFDSNWSChannels(session, uri, callback) {

  // Hoist this
  var queryString = querystring.stringify({
    "level": "channel",
    "format": "text",
  });

  queryString += "&" + uri.query;

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, callback);

}

function ParseFDSNWSResponseChannel(data) {

  if(data === null) {
    return JSON.stringify(new Array());
  }

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
  return data.split("\n").slice(1, -1).map(function(x) {

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

  });

}

function getSubmittedFiles(session, callback) {

  /* function getSubmittedFiles
   * Abstracted function to read files from multiple directories
   * and concatenate the result
   */

  // Stages:
  // Pending -> Accepted | Rejected
  var pipeline = [{
    "$match": {
      "userId": Database.ObjectId(session._id),
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

function GetFDSNWSStations(session, callback) {

  /* Function GetFDSNWSStations
   * Returns station information from FDSNWS Station
   */

  // Hoist this
  var queryString = querystring.stringify({
    "level": "station",
    "format": "text",
    "network": session.network
  })

  OHTTP.request(CONFIG.FDSNWS.STATION.HOST + "?" + queryString, callback);

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

  return multipart.Parse(buffer, boundary);

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

  // Replace entities
  return String(string).replace(/[&<>"'`=\/]/g, function(character) {
    return entityMap[character];
  });

}

Init();

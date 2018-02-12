const http = require("http");
const crypto = require("crypto");
const path = require("path");
const url = require("url");
const fs = require("fs");
const querystring = require("querystring");
const Database = require("./orfeus-database");
const Multipart = require("./multipart");
const Session = require("./orfeus-session");
const Console = require("./orfeus-logging");
const CONFIG = require("./config");

const HTTP_REDIRECT_STATUS_CODE = 301

function getSession(headers, callback) {

  /* function getSession
   * Attempts to get a session identifier by a header cookie
   * from the sessions database
   */

  // Cookie not set in HTTP request headers
  if(headers.cookie === undefined) {
    return callback(null);
  }

  // Parse the cookie header and get the SESSION_ID
  var cookie = querystring.parse(headers.cookie.split(";")[0]);
  var sessionQuery = {"SESSION_ID": cookie.SESSION_ID};

  Database.sessions().findOne(sessionQuery, function(error, session) {

    // Error or session could not be found
    if(error || session === null) {
      return callback(null);
    }

    Database.users().findOne({"_id": session.userId}, function(error, user) {

      // Error or no user could be found
      if(error || user === null) {
        return callback(null);
      }

      // Callback with a new authenticated user
      callback(new User(user));

    });

  });

}

var User = function(user) {

  /* Class User
   * Holds user information
   */

  this._id = user._id;
  this.username = user.username;
  this.networks = user.networks;
  this.visited = user.visited;

  // Path where the user stores uploaded files
  this.filepath = path.join("files", user.username); 

}

function Unauthorized(response) {
  response.writeHead(401);
  response.end(generate401());
}

function ServerError(response) {
  response.writeHead(500);
  response.end(generate500());
}

function Redirect(response, path) {
  var headers = {"Location": path};
  response.writeHead(HTTP_REDIRECT_STATUS_CODE, headers);
  response.end();
}

function Init() {

  /* function Init
   * Initializes the application
   */

  const DATABASE_CONNECTION_ERROR = "FATAL: Could not open connection to the database.";

  // Attempt to connect to the database
  Database.connect(function(error) {
  
    // Could not connect to Mongo
    if(error) {
      throw(DATABASE_CONNECTION_ERROR);
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
    "userId": user._id
  }

  // Update users last visited information
  Database.users().updateOne({"_id": user._id}, {"$set": {"visited": new Date()}});

  // Insert a new session
  Database.sessions().insertOne(storeObject, function(error, result) {

    // Error creating a session
    if(error) {
      return callback(null);
    }

    Console.debug("New session with ID " + session.id + " created.");

    callback(Cookie(session));

  });

}

var Webserver = function() {

  /* Class Webserver
   * Opens NodeJS webservice on given PORT
   */

  // Create the HTTP server and listen to incoming requests
  var webserver = http.createServer(function(request, response) {
  
    // Prevent browser-side caching of sessions
    response.setHeader("Cache-Control", "private, no-cache, no-store, must-revalidate");

    // Parse the resource identifier
    const uri = url.parse(request.url).pathname;
    const clientIp = request.headers['x-forwarded-for'] || request.connection.remoteAddress || null;

    Console.debug(clientIp + " requested resource: " + uri);

    if(uri === "/images/node.png") {
      response.writeHead(200, {
        "Content-Type": "image/png"
      });
      return fs.createReadStream("./images/node.png").pipe(response);
    }

    if(uri === "/images/station.png") {
      response.writeHead(200, {
        'Content-Type': "image/png"
      });
      return fs.createReadStream("./images/station.png").pipe(response);
    }
  
    // Application script is requested
    if(uri === "/js/app.js") {
      response.writeHead(200, {
        'Content-Type': "application/javascript"
      });
      return fs.createReadStream("./app.js").pipe(response);
    }
  
    // Application style sheet is requested
    if(uri === "/css/style.css") {
      response.writeHead(200, {
        'Content-Type': "text/css"    
      });
      return fs.createReadStream("./style.css").pipe(response);
    }
  
    // Redirect webserver root to login page
    if(uri === "/") {
      return Redirect(response, "/login");
    }

     /* An authenticated session may be required
      */

    getSession(request.headers, function(session) {
  
      // Log in
      if(uri.startsWith("/login")) {
  
        // If the user is already logged in redirect to profile page
        if(session !== null) {
          return Redirect(response, "/profile");
        }
  
        // Get request is made on the login page
        response.writeHead(200, {"Content-Type": "text/html"});
        response.write(generateLogin(request.url));
        return response.end();
  
      }
  
      // URL for posting messages
      if(uri === "/send") {

        // Parse the POSTed request body as JSON
        parseRequestBody(request, "json", function(postBody) {

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
              return Redirect(response, "/profile/messages/new?unknown");
            }

            // Create a new message
            const messageBody = users.map(function(user) {
              return {
                "recipient": user._id,
                "sender": session._id,
                "content": escapeHTML(postBody.content),
                "subject": escapeHTML(postBody.subject),
                "read": false,
                "recipientDeleted": false,
                "created": new Date(),
                "level": 0
              }
            });

            // Store all messages
            Database.messages().insertMany(messageBody, function(error, result) {

              // Error storing messages
              if(error) {
                return Redirect(response, "/profile/messages/new?failure");
              }

              Redirect(response, "/profile/messages/new?success");

            });

          });

        });

        return;

      }


      // Method for authentication
      if(uri === "/authenticate") {
  
        // If the user is already logged in redirect to profile page
        if(session !== null) {
          return Redirect(response, "/profile");
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
                return ServerError(response);
              }

              // Redirect user to profile page and set a cookie for this session
              response.writeHead(HTTP_REDIRECT_STATUS_CODE, {
                "Set-Cookie": cookie,
                "Location": "./profile"
              });
  
              response.end();
  
            });
  
          });
  
        });
  
        return;
  
      }
  
      // Roadblock for non-authenticated sessions
      if(session === null) {
        return Unauthorized(response);
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
        Database.sessions().deleteOne({"userId": session._id}, function(error, result) {
          Redirect(response, "/login?logout");
          Console.debug("Session for " + session.username + " has been removed.");
        });

        return;
  
      }
  
      // Profile page
      if(uri === "/profile") {
        return response.end(generateProfile(session));
      }

      if(uri === "/profile/messages") {
        return response.end(generateMessages(session));
      }

      if(uri === "/profile/messages/new") {
        return response.end(sendNewMessage(request.url, session));
      }

      if(uri.startsWith("/profile/messages/detail")) {
        return response.end(generateMessageDetails(session));
      }
   
      // Station details page
      if(uri === "/profile/station") {
        return response.end(generateStationDetails(session));
      }

      if(uri === "/upload") {
  
        if(request.method !== "POST") {
          return response.end();
        }
  
        // Parse the POST body (binary file)
        parseRequestBody(request, "multiform", function(files) {

          messageAdministrators(files, session);

          files.forEach(function(file) {
            fs.writeFile(path.join(session.filepath, file.filename), file.data, function(error) {

              if(error) {
                Console.error("Could not write file " + file.filename);
              }

            });
          });

          return Redirect(response, "/profile");

        });
  
        return;
  
      }

      response.writeHead(404, {"Content-Type": "text/html"});
      response.write(generate404());
      response.end();
  
    });
  
  });

  webserver.listen(CONFIG.PORT, CONFIG.HOST, function() {
    Console.info("Webserver started at " + CONFIG.HOST + ":" + CONFIG.PORT);
  });

}

function generate401() {

    return [
      generateHeader(),
      "  <body>",
      "    <div class='container'>",
      "      <div class='form-signin'>",
      "        <h2 class='form-signin-heading'>401 Unauthorized</h2>",
      "      </div>",
      "    </div>",
      "  </body>",
      generateFooter(),
      "</html>"
    ].join("\n");

}

function generate500() {

    /* function generate500
     * Template for HTTP Error Code 500
     */

    return [
      generateHeader(),
      "  <body>",
      "    <div class='container'>",
      "      <div class='form-signin'>",
      "        <h2 class='form-signin-heading'>500 Internal Server Error</h2>",
      "      </div>",
      "    </div>",
      "  </body>",
      generateFooter(),
      "</html>"
    ].join("\n");

}

function generate404() {

    return [
      generateHeader(),
      "  <body>",
      "    <div class='container'>",
      "      <div class='form-signin'>",
      "        <h2 class='form-signin-heading'>404 File Not Found</h2>",
      "      </div>",
      "    </div>",
      "  </body>",
      generateFooter(),
      "</html>"
    ].join("\n");

}

function getAdministrators(callback) {

 Database.users().find({"role": "admin"}).toArray(function(error, users) {

   if(error || users.length === 0) {
     return callback(null);
   }

   callback(users)

 });

}

function messageAdministrators(files, sender) {

  /* function messageAdministrators
   * Queries the database for all administrators
   */

  getAdministrators(function(users) {

    if(users === null) {
      return
    }

    var messages = new Array();

    users.forEach(function(user) {

      if(user._id.toString() === sender._id.toString()) {
        return;
      }

      messages = messages.concat(files.map(function(file) {
        return {
          "recipient": user._id,
          "sender": sender._id,
          "content": "A new file has been uploaded: " + file.filename,
          "subject": "File Uploaded",
          "read": false,
          "recipientDeleted": false,
          "created": new Date(),
          "level": 0
        }
      }));
    });

    Console.debug("Messages " + users.length + " adminstrators about " + files.length + " file(s) uploaded");
 
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
      if(uri.search === "?new") {
        GetNewMessages(session, function(json) {
          response.end(json);
        });
      } else if(uri.search === "?deleteall") {
        RemoveAllMessages(session, function(json) {
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

    response.writeHead(404, {"Content-Type": "text/html"});
    response.write(generate404());
    response.end();

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

  var query = {
    "recipient": Database.ObjectId(session._id),
    "recipientDeleted": false,
    "_id": Database.ObjectId(qs.delete)
  }

  // Get specific message from the database
  Database.messages().updateOne(query, {"$set": {"recipientDeleted": true}}, function(error, message) {

    if(error || message.result.nModified === 0) {
      return callback(JSON.stringify(null));
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
      "sender": Database.ObjectId(session._id)
    }],
    "_id": Database.ObjectId(qs.read)
  }

  // Get specific message from the database
  Database.messages().findOne(query, function(error, message) {

    if(error || message === null) {
      Console.error("Error getting single message from database.");
      return callback(null);
    }

    // Set message to read
    if(message.sender.toString() !== session._id.toString()) {
      Database.messages().updateOne(query, {"$set": {"read": true}});
    }

    // Find the username for the message sender 
    Database.users().findOne({"_id": Database.ObjectId(message.sender)}, function(error, user) {

      var messageContent = {
        "sender": user.username,
        "subject": message.subject,
        "content": message.content,
        "created": message.created,
        "role": user.role,
        "read": message.read,
        "author": message.sender.toString() === session._id.toString()
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
      "sender": Database.ObjectId(session._id)
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
          "sender": hashMap[x.sender].username,
          "recipient": hashMap[x.recipient].username,
          "created": x.created,
          "_id": x._id,
          "read": x.read,
          "role": hashMap[x.sender].role,
          "author": x.sender.toString() === session._id.toString()
        }
      });
      
      callback(JSON.stringify(messageContents));

    });

  });

}

function GetStationLatency(session, callback) {

  const LATENCY_URL = "http://127.0.0.1:3001";

  var queryString = querystring.stringify({
    "network": session.networks.join(",")
  });

  var request = http.get(LATENCY_URL + "?" + queryString, function(response) {

    // Response was 204 No Content
    if(response.statusCode === 204) {
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
      if(response.statusCode !== 200) {
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

  // Open HTTP GET request
  var request = http.get(FDSNWS_STATION_URL + "?" + queryString, function(response) {

    // Response was 204 No Content
    if(response.statusCode === 204) {
      return callback(null);
    }

    var chunks = new Array();

    // Data chunk received
    response.on("data", function(chunk) {
      chunks.push(chunk);
    });

    // HTTP Get request ended
    response.on("end", function() {

      if(response.statusCode !== 200) {
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

  // Open HTTP GET request
  var request = http.get(FDSNWS_STATION_URL + "?" + queryString, function(response) {

    // Response was 204 No Content
    if(response.statusCode === 204) {
      return callback(null);
    }

    var chunks = new Array();

    // Data chunk received
    response.on("data", function(chunk) {
      chunks.push(chunk);
    });

    // HTTP Get request ended
    response.on("end", function() {

      if(response.statusCode !== 200) {
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

function SHA256Password(password) {
  return crypto.createHash("sha256").update(password).digest("hex");
}

function Authenticate(postBody, callback) {

  Database.users().findOne({"username": postBody.username}, function(err, result) {

    if(result === null) { return callback(false) }
    if(err) { return callback(false) }

    if(result.password === SHA256Password(postBody.password)){
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
    "    <meta name='description' content='ORFEUS Monitoring Service'>",
    "    <meta name='author' content='ORFEUS Data Center'>",
    "    <title>ORFEUS Monitoring Service</title>",
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
    "        <h2 class='form-signin-heading'><span style='color: #C03;'>O</span>RFEUS Monitoring Service</h2>",
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
    "  <script src='/js/app.js'></script>",
  ].join("\n");

}

function generateFooter() {

  return [
    "  <footer class='container text-muted'>",
    "  <hr>",
    "  ORFEUS Monitoring Service &copy; ORFEUS Data Center " + new Date().getFullYear() + " - All Rights Reserved.",
    "  <div style='float: right;'><small>Version v" + CONFIG.APPLICATION_VERSION + "</small></div>",
    "  </footer>",
    "  <link rel='stylesheet' href='https://maxcdn.bootstrapcdn.com/font-awesome/4.7.0/css/font-awesome.min.css'>",
    "  <link rel='stylesheet' href='https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-alpha.6/css/bootstrap.min.css' integrity='sha384-rwoIResjU2yc3z8GV/NPeZWAv56rSmLldC3R/AZzGRnGxQQKnKkoFVhFQhNUwEyJ' crossorigin='anonymous'>",
    "  <link rel='stylesheet' href='/css/style.css'>",
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
    "        <a class='btn btn-success btn-sm' href='/profile/messages/new'><span class='fa fa-plus-square'></span> New Message</a>",
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
    "            <button onClick='deleteAllMessages()' class='btn btn-danger btn-sm' id='delete-all-messages'><span class='fa fa-minus-square'></span> &nbsp; Delete All</button>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='messages-sent-tab' role='tabpanel'>",
    "          <div id='message-content-sent'></div>",
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
    "    <div class='container'>",
    "      <div style='float: right;'>",
    "        <a href='/profile/messages'><span class='badge badge-success'><span class='fa fa-envelope' aria-hidden='true'></span> <small><span id='number-messages'></span></small></span></a>",
    "        &nbsp;",
    "        <a href='/logout'><span class='fa fa-sign-out' aria-hidden='true'></span><small>Logout</small></a>",
    "      </div>",
    "      <h2 class='form-signin-heading'><span style='color: #C03;'>O</span>RFEUS Monitoring Service</h2>",
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
    "            Last visit at <span class='fa fa-clock-o'></span> <b>" + session.visited + "</b>",
    "          </small>",
    "        </div>",
    "        <h3>",
    "          <span class='fa fa-user-circle-o' aria-hidden='true'></span> " + session.username + " <small class='text-muted'>" + session.networks.join(", ") + "</small>",
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
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#settings-container-tab'><span class='fa fa-cog' aria-hidden='true'></span> &nbsp; Settings</a>",
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
    "          <div class='input-group'>",
    "            <span class='input-group-addon'><span class='fa fa-search' aria-hidden='true'> Search</span></span>",
    "            <input class='form-control' id='table-search'/>",
    "          </div>",
    "          <div id='table-container'></div>",
    "          <div id='table-pagination'></div>",  
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
    "          <form class='form-signin' method='post' action='upload' enctype='multipart/form-data'>",
    "            <div class='form-group row'>",
    "              <label class='custom-file'>",
    "                <input id='file-stage' name='file-data' type='file' class='form-control-file' aria-describedby='fileHelp'>",
    "                <span class='custom-file-control'></span>",
    "              </label>",
    "              &nbsp;",
    "              <input class='btn btn-success' type='submit' value='Upload Metadata'>",
    "            </div>",
    "            <div class='form-group row'>",
    "              <small id='file-help' class='form-text text-muted'></small>",
    "            </div>",
    "          </form>",
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

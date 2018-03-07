const http = require("http");
const dns = require("dns");

const { generateHTTPError } = require("./orfeus-template");
const { sum } = require("./orfeus-util");
const CONFIG = require("../config");
const Console = require("./orfeus-logging");
const multipart = require("./multipart");
const querystring = require("querystring");

const S_HTTP_OK = 200;
const S_HTTP_NO_CONTENT = 204;
const S_HTTP_REDIRECT = 301;
const E_HTTP_UNAUTHORIZED = 401;
const E_HTTP_FILE_NOT_FOUND = 404;
const E_HTTP_PAYLOAD_TOO_LARGE = 413;
const E_HTTP_TEAPOT = 418;
const E_HTTP_INTERNAL_SERVER_ERROR = 500;
const E_HTTP_NOT_IMPLEMENTED = 501;
const E_HTTP_UNAVAILABLE = 503;

function HTTPError(response, status) {

  /* function HTTPError
   * Returns templated HTTP error for a code
   */

  response.writeHead(status, {"Content-Type": "text/html"});
  response.end(generateHTTPError(status));

}

function request(url, callback) {

  /* function Request
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

      // Not 200 OK: quit
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

function writeJSON(json) {

  /* function writeJSON
   * Writes JSON response and sets headers
   */

  if(!json) {
    json = new Array();
  }

  this.writeHead(S_HTTP_OK, {"Content-Type": "application/json"});
  this.end(JSON.stringify(json));

}

function getDNS(hosts, callback) {

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

    // Asynchronous but concurrent lookup
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

function Redirect(response, path) {

  var headers = {"Location": path};
  response.writeHead(S_HTTP_REDIRECT, headers);
  response.end();

}

function parseRequestBody(request, response, type, callback) {

  /* function parseRequestBody
   * parses postBody
   */

  var chunks = new Array();

  // Data received from client
  request.on("data", function(chunk) {

    chunks.push(chunk);

    // Limit the maximum number of bytes that can be posted
    if(sum(chunks) > CONFIG.MAXIMUM_POST_BYTES) {
      return HTTPError(response, E_HTTP_PAYLOAD_TOO_LARGE);
    }

  });

  // Request has been ended by client
  request.on("end", function() {

    // The request was aborted by the server
    if(response.finished) {
      return;
    }

    // Add all chunks to a string buffer
    var fullBuffer = Buffer.concat(chunks);

    // Support for different types of data
    switch(type) {
      case "multiform":
        return callback(parseMultiform(fullBuffer, request.headers));
      case "json":
        return callback(querystring.parse(fullBuffer.toString()));
      default:
        return null;
    }

  });

}

function parseMultiform(buffer, headers) {

  /* function parseMultiform
   * Parses multiform encoded data
   */

  return multipart.Parse(buffer, multipart.getBoundary(headers["content-type"]));

}

module.exports = {
  parseRequestBody,
  request,
  writeJSON,
  HTTPError,
  getDNS,
  Redirect,
  S_HTTP_OK,
  S_HTTP_NO_CONTENT,
  S_HTTP_REDIRECT,
  E_HTTP_PAYLOAD_TOO_LARGE,
  E_HTTP_UNAVAILABLE,
  E_HTTP_NOT_IMPLEMENTED,
  E_HTTP_UNAUTHORIZED,
  E_HTTP_FILE_NOT_FOUND,
  E_HTTP_TEAPOT,
  E_HTTP_INTERNAL_SERVER_ERROR
}

/* lib/orfeus-http.js
 * 
 * Wrapper for HTTP calls
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2017
 *
 */

const http = require("http");
const dns = require("dns");
const querystring = require("querystring");

// Third party libs
const multipart = require("./lib/multipart");

//
const { generateHTTPError } = require("./lib/orfeus-template");
const { sum } = require("./lib/orfeus-util");
const Console = require("./lib/orfeus-logging");
const CONFIG = require("./config");

// HTTP Status Codes
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

      // 200 OK
      if(response.statusCode === S_HTTP_OK) {
        return callback(Buffer.concat(chunks).toString());
      }

      return callback(null);

    });

  });

  // There was an error with the request (e.g. ECONNREFUSED)
  request.on("error", function(error) {
    Console.error(error)
    return callback(null);
  });

  request.end();

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

function redirect(response, path) {

  /* function redirect
   * Redirects request to another location
   */

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
  HTTPError,
  getDNS,
  redirect,
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

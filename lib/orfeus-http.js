const http = require("http");
const dns = require("dns");

const { generateHTTPError } = require("./orfeus-template");
const Console = require("./orfeus-logging");

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

function writeJSON(response, json) {

  /* function writeJSON
   * Writes JSON response and sets headers
   */

  if(!json) {
    json = new Array();
  }

  response.writeHead(S_HTTP_OK, {"Content-Type": "application/json"});
  response.end(JSON.stringify(json));

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

module.exports = {
  request,
  writeJSON,
  HTTPError,
  getDNS,
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

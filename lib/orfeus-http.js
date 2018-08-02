/* lib/orfeus-http.js
 * 
 * Wrapper for HTTP related calls
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const { get } = require("http");
const { lookup } = require("dns");

//
const Console = require("./lib/orfeus-logging");

// HTTP Status Codes
const S_HTTP_OK = 200;
const S_HTTP_NO_CONTENT = 204;
const S_HTTP_REDIRECT = 301;
const E_HTTP_UNAUTHORIZED = 401;
const E_HTTP_FORBIDDEN = 403;
const E_HTTP_FILE_NOT_FOUND = 404;
const E_HTTP_PAYLOAD_TOO_LARGE = 413;
const E_HTTP_TEAPOT = 418;
const E_HTTP_INTERNAL_SERVER_ERROR = 500;
const E_HTTP_NOT_IMPLEMENTED = 501;
const E_HTTP_UNAVAILABLE = 503;

const MIME = {
  "JSON": {"Content-Type": "application/json"},
  "ICON": {"Content-Type": "image/x-icon"},
  "CSS": {"Content-Type": "text/css"},
  "PNG": {"Content-Type": "image/png"},
  "JS": {"Content-Type": "application/javascript"},
  "HTML": {"Content-Type": "text/html"},
  "XML": {"Content-Type": "application/xml"},
  "TEXT": {"Content-Type": "text/plain"}
}

function request(url, callback) {

  /* function OHTTP.request
   * Makes HTTP GET request to url and fires callback on completion
   */

  // Open HTTP GET request
  var request = get(url, function(response) {

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

function getDNS(servers, DNSCallback) {

  /* function GetDNS
   * Asynchronously gets DNS for multiple hosts
   * and fires callback on completion
   */

  var server, DNSQuery, DNSTimer;
  var DNSRecords = new Array();

  (DNSQuery = function() {

    DNSTimer = Date.now();

    server = servers.pop();

    // Asynchronous but concurrent lookup
    lookup(server.host, function(error, IPAddress) {

      Console.debug("DNS lookup to " + server.host + " completed in " + (Date.now() - DNSTimer) + "ms (" + (IPAddress || error.code) + ")");

      // Push a single DNS record with host, port, IP
      DNSRecords.push({
        "host": server.host,
        "port": server.port,
        "ip": IPAddress || error.code
      });

      // Continue with next lookup
      if(servers.length) {
        return DNSQuery();
      }

      DNSCallback(DNSRecords);

    });

  })();

}

module.exports = {
  request,
  getDNS,
  MIME,
  S_HTTP_OK,
  S_HTTP_NO_CONTENT,
  S_HTTP_REDIRECT,
  E_HTTP_PAYLOAD_TOO_LARGE,
  E_HTTP_UNAVAILABLE,
  E_HTTP_NOT_IMPLEMENTED,
  E_HTTP_FORBIDDEN,
  E_HTTP_UNAUTHORIZED,
  E_HTTP_FILE_NOT_FOUND,
  E_HTTP_TEAPOT,
  E_HTTP_INTERNAL_SERVER_ERROR
}

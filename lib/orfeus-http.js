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
const multiparty = require("multiparty");

//
const logger = require("./lib/orfeus-logging");

const CONFIG = require("./config");

// HTTP Status Codes
const S_HTTP_OK = 200;
const S_HTTP_NO_CONTENT = 204;
const S_HTTP_REDIRECT = 301;
const E_HTTP_BAD_REQUEST = 400;
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

  /*
   * Function OHTTP.request
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
    logger.error(error)
    return callback(null);
  });

  request.end();

}

function handlePOSTForm(request, parsedCallback) {

  /*
   * Function handlePOSTForm
   * Calls multiparty library to handle parsing of multipart data
   */

  const form = new multiparty.Form();

  var files = new Array();
  var properties = new Object();

  // Callback when a part is received
  form.on("part", function(part) {

    var chunks = new Array();

    // Make sure to collect all buffers before 
    part.on("data", function(data) {
      chunks.push(data);
    });

    // Files have a filename, and parameters do not
    part.on("end", function() {

      var data = Buffer.concat(chunks).toString();

      // Split file data and property data
      if(part.filename) {
        files.push(data);
      } else {
        properties[part.name] = data;
      }

    });

  }.bind(this));

  // Parsing completed
  form.on("close", function() {
    parsedCallback(null, { files, properties });
  }.bind(this));

  // When an error occurs
  form.on("error", function(error) {
    parsedCallback(error);
  });

  // Attach the request
  form.parse(request);

}

function getDNS(servers, DNSCallback) {

  /* Function GetDNS
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

      logger.debug("DNS lookup to " + server.host + " completed in " + (Date.now() - DNSTimer) + "ms (" + (IPAddress || error.code) + ")");

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

function getDNSLookup(networkCode, servers, callback) {

  /*
   * Function getDNSLookup
   * Does a DNS lookup on Seedlink servers and proceeds with response
   */

  const SEEDLINK_API_URL = "http://" + CONFIG.STATIONS.HOST + ":" + CONFIG.STATIONS.PORT;

  // Query the DNS records
  getDNS(servers, function(DNSRecords) {

    // Combine all servers and ports
    var serversAndPorts = DNSRecords.map(x => x.host + ":" + x.port).join(",");

    // Make the request to the internal API
    request(SEEDLINK_API_URL + "?host=" + serversAndPorts, function(seedlinkServers) {

      if(seedlinkServers === null) {
        return callback(DNSRecords);
      }

      // Add some Seedlink metadata
      callback(attachSeedlinkMetadata(networkCode, DNSRecords, seedlinkServers));

    }.bind(this));

  }.bind(this));

}

function attachSeedlinkMetadata(networkCode, DNSRecords, seedlinkServers) {

  /*
   * Function attachSeedlinkMetadata
   * Attaches seedlink metadata (e.g. version, identifier) to a DNS record
   */

  var seedlinkServers = JSON.parse(seedlinkServers);

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
         "stations": seedlinkServer.error === "CATNOTIMPLEMENTED" ? null : seedlinkServer.stations.filter(station => station.network === networkCode)
       }
     }

   }

   return x;

 });

 return results;

}

module.exports = {
  request,
  getDNS,
  MIME,
  getDNSLookup,
  handlePOSTForm,
  S_HTTP_OK,
  S_HTTP_NO_CONTENT,
  S_HTTP_REDIRECT,
  E_HTTP_BAD_REQUEST,
  E_HTTP_PAYLOAD_TOO_LARGE,
  E_HTTP_UNAVAILABLE,
  E_HTTP_NOT_IMPLEMENTED,
  E_HTTP_FORBIDDEN,
  E_HTTP_UNAUTHORIZED,
  E_HTTP_FILE_NOT_FOUND,
  E_HTTP_TEAPOT,
  E_HTTP_INTERNAL_SERVER_ERROR
}

const http = require("http");

const S_HTTP_NO_CONTENT = 204;
const S_HTTP_OK = 200;

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

module.exports = HTTPRequest;

const http = require("http");

const S_HTTP_OK = 200;
const S_HTTP_NO_CONTENT = 204;
const S_HTTP_REDIRECT = 301;
const E_HTTP_UNAVAILABLE = 503;
const E_HTTP_UNAUTHORIZED = 401;
const E_HTTP_FILE_NOT_FOUND = 404;
const E_HTTP_TEAPOT = 418;
const E_HTTP_INTERNAL_SERVER_ERROR = 500;

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

module.exports = {
  request,
  S_HTTP_OK,
  S_HTTP_NO_CONTENT,
  S_HTTP_REDIRECT,
  E_HTTP_UNAVAILABLE,
  E_HTTP_UNAUTHORIZED,
  E_HTTP_FILE_NOT_FOUND,
  E_HTTP_TEAPOT,
  E_HTTP_INTERNAL_SERVER_ERROR
}

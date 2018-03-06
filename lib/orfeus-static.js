const path = require("path");
const fs = require("fs");

const Console = require("./orfeus-logging");
const CONFIG = require("../config");

function getStaticFilesRecursively(dir) {

  /* function getStaticFilesRecursively
   * Synchronously read files from directories
   */

  const SUPPORTED_EXT = [
    ".png",
    ".css",
    ".js"
  ];

  var files = new Array();

  fs.readdirSync(dir).forEach(function(file) {

    var filepath = path.join(dir, file);

    // Recursive in directory
    if(!fs.statSync(filepath).isDirectory()) {

      // Skip non-supported extensions
      if(SUPPORTED_EXT.indexOf(path.extname(filepath)) === -1) {
        return;
      }

      var tmp = filepath.split("/");
      tmp[0] = "";
      return files.push(tmp.join("/"));

    }

    files = files.concat(getStaticFilesRecursively(filepath));

  });

  return files;

}

const staticFiles = getStaticFilesRecursively(CONFIG.STATIC.DIRECTORY);

staticFiles.forEach(function(x) {
  Console.debug("Serving static file " + path.basename(x));
});

module.exports = staticFiles; 

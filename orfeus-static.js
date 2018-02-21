const path = require("path");
const fs = require("fs");
const Console = require("./orfeus-logging");

const STATIC_DIRECTORY = "static";    
const SUPPORTED_EXT = [".png", ".css", ".js"];

function getStaticFilesRecursively(dir) {

  /* function getStaticFilesRecursively
   * Synchronously read files from directories
   */

  var files = new Array();

  fs.readdirSync(dir).forEach(function(file) {

    var filepath = path.join(dir, file)

    // Recursive in directory
    if(!fs.statSync(filepath).isDirectory()) {

      // Skip non-supported extensions
      if(SUPPORTED_EXT.indexOf(path.extname(filepath)) === -1) {
        return;
      }

      Console.debug("Serving static file " + path.basename(filepath));
      return files.push(filepath.replace(STATIC_DIRECTORY, ""))

    }

    files = files.concat(getStaticFilesRecursively(filepath))

  });

  return files

}

module.exports = getStaticFilesRecursively(STATIC_DIRECTORY);

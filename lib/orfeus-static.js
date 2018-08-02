const path = require("path");
const fs = require("fs");

const Console = require("./lib/orfeus-logging");
const CONFIG = require("./config");

function getStaticFilesRecursively(dir) {

  /* function getStaticFilesRecursively
   * Synchronously read files from directories
   */

  const SUPPORTED_EXT = [
    ".png",
    ".css",
    ".js",
    ".sc3ml"
  ];

  var files = new Array();

  fs.readdirSync(dir).forEach(function(file) {

    var filepath = path.join(dir, file);

    // Recursive in directory
    if(!fs.statSync(filepath).isDirectory()) {

      // Skip non-supported extensions
      if(!SUPPORTED_EXT.includes(path.extname(filepath))) {
        return;
      }

      return files.push(path.join("/", filepath.split("/").slice(1).join("/")));

    }

    files = files.concat(getStaticFilesRecursively(filepath));

  });

  return files;

}

const staticFiles = getStaticFilesRecursively(CONFIG.STATIC.DIRECTORY);

staticFiles.forEach(x => Console.debug("Serving static file " + path.basename(x)));

module.exports = staticFiles; 

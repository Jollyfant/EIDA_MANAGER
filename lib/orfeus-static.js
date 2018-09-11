/*
 * EIDA Manager - lib/orfeus-static.js
 *
 * Synchronously sets up static files for the webserver
 *
 * Copyright ORFEUS Data Center, 2018
 * Author: Mathijs Koymans
 * License: MIT
 *
 */ 

// Native libs
const path = require("path");
const fs = require("fs");

const logger = require("./lib/orfeus-logging");
const CONFIG = require("./config");

function getStaticFilesRecursively(directory) {

  /*
   * Function getStaticFilesRecursively
   * Synchronously read files from directories
   */

  // Other extensions will be skipped
  const SUPPORTED_EXT = [
    ".png",
    ".css",
    ".js",
    ".sc3ml",
    ".xsd"
  ];

  var files = new Array();

  fs.readdirSync(directory).forEach(function(file) {

    var filepath = path.join(directory, file);

    // Recursive in directory
    if(!fs.statSync(filepath).isDirectory()) {

      // Skip non-supported extensions
      if(!SUPPORTED_EXT.includes(path.extname(filepath))) {
        return;
      }
 
      logger.debug("Serving static file " + path.basename(filepath));

      return files.push(path.join("/", filepath.split("/").slice(1).join("/")));

    }

    files = files.concat(getStaticFilesRecursively(filepath));

  });

  return files;

}

// Get all the static files from the "static" directory
module.exports = getStaticFilesRecursively(CONFIG.STATIC.DIRECTORY); 

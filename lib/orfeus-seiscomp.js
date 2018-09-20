/*
 * EIDA Manager - lib/orfeus-seiscomp.js
 * 
 * Wrapper for EIDA Manager SeisComP3 child process calls
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const childProcess = require("child_process");

const logger = require("./lib/orfeus-logging");
const CONFIG = require("./config");

function isWriteable(stream) {

  /*
   * Function isWriteable
   * Returns whether stream is writable
   */

  function isStream(stream) {
  
    /*
     * Function isStream
     * Returns whether variable is stream
     */

    return (
      stream !== null &&
      typeof stream === "object" &&
      typeof stream.pipe === "function"
    );
  
  }

  return (
    isStream(stream) &&
    stream.writable !== false &&
    typeof stream._write === "function" &&
    typeof stream._writableState === "object"
  );

}

function defaultHandler(convertor, callback) {

  /*
   * Function defaultHandler
   * Default SeisComP3 subprocess handler
   */

  var chunks = new Array();

  // Default error handler
  convertor.on("error", function(error) {
    logger.error(error);
  });

  // Save stderr
  convertor.stderr.on("data", function(data) {
    chunks.push(data);
  });

  // Child process has closed
  convertor.on("close", function(code) {
    callback((Buffer.concat(chunks).toString() || null), code);
  });

}

function convertSC3ML(input, output, callback) {

  /*
   * Function convertSC3ML
   * Converts a StationXML file to SC3ML format
   */

  var command = new Array("exec", "fdsnxml2inv", input, "-f", output);
  
  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, command);

  defaultHandler(convertor, callback);

}

function restartFDSNWS(callback) {

  /*
   * Function restartFDSNWS
   * Function call to restart the FDSN Station Webservice
   */

  var command = new Array("restart", "fdsnws");

  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, command);

  defaultHandler(convertor, callback);

}

function mergeSC3ML(files, output, callback) {

  /*
   * Function mergeSC3ML
   * Merges multiple SC3ML files to a single inventory
   */

  const FILENAME = CONFIG.NODE.ID + "-sc3ml-full-inventory";

  // Get the SC3ML filenames and add them to the CMDline
  var command = new Array("exec", "scinv", "merge");

  // A filename was passed
  if(typeof output === "string") {
    command = command.concat(new Array("-o", output));
  }

  // Add all the files to be merged
  command = command.concat(files);

  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, command);

  defaultHandler(convertor, callback);

  // When the response object is passed pipe stdout to response writeable stream
  if(output !== null && typeof output !== "string") {

    // Write the headers
    convertor.stdout.once("data", function() {
      output.writeHead(200, {"Content-Disposition": "attachment;filename=" + FILENAME});
    });

    // Pipe stdout of SeisComP3 to the response
    convertor.stdout.pipe(output); 

  }

}

function updateInventory(callback) {

  /*
   * Function updateInventory
   * Updates the SeisComP3 inventory from file using update-config
   */

  // SeisComP3 command to update the MySQL database
  var command = new Array("update-config", "inventory");

  // Spawn the SeisComP3 subprocess
  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, command);

  defaultHandler(convertor, callback);

}

module.exports = {
  convertSC3ML,
  mergeSC3ML,
  restartFDSNWS,
  updateInventory
}

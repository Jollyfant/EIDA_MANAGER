/* lib/orfeus-logging.js
 * 
 * Wrapper for logging
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const fs = require("fs");
const CONFIG = require("./config");

var Console = function() {

  if(CONFIG.__STDOUT__) {
    this.log = process.stdout;
  } else {
    this.log = fs.createWriteStream(CONFIG.LOGFILE, {"flags": "w"});
  }

}

Console.prototype.write = function(array) {

  this.log.write(Array.from(arguments).join(" ") + "\n");

}

Console.prototype.fatal = function(msg) {

  var FATAL_COLOR_EPI, FATAL_COLOR_PRO;

  if(CONFIG.__STDOUT__) {
    FATAL_COLOR_EPI = "\x1b[0m";
    FATAL_COLOR_PRO = "\x1b[31m";
  }

  this.write(
    new Date().toISOString(),
    FATAL_COLOR_PRO,
    "FATAL",
    FATAL_COLOR_EPI,
    msg
  );

}

Console.prototype.error = function(msg) {

  /* Function Console.error
   * Logs an error entry
   */

  var ERROR_COLOR_EPI, ERROR_COLOR_PRO;

  if(CONFIG.__STDOUT__) {
    ERROR_COLOR_EPI = "\x1b[0m";
    ERROR_COLOR_PRO = "\x1b[31m";
  }

  // Debug write the stack of the error
  if(CONFIG.__DEBUG__) {
    msg = msg.stack;
  }

  this.write(
    new Date().toISOString(),
    ERROR_COLOR_PRO,
    "ERROR",
    ERROR_COLOR_EPI,
    msg
  );

}

Console.prototype.info = function(msg) {

  var INFO_COLOR_EPI, INFO_COLOR_PRO

  if(CONFIG.__STDOUT__) {
    INFO_COLOR_EPI = "\x1b[0m";
    INFO_COLOR_PRO = "\x1b[34m";
  }

  this.write(
    new Date().toISOString(),
    INFO_COLOR_PRO,
    "INFO",
    INFO_COLOR_EPI,
    msg
  );

}

Console.prototype.access = function(msg) {

  var ACCESS_COLOR_EPI, ACCESS_COLOR_PRO;

  if(CONFIG.__STDOUT__) {
    ACCESS_COLOR_EPI = "\x1b[0m";
    ACCESS_COLOR_PRO = "\x1b[33m";
  }

  this.write(
    new Date().toISOString(),
    ACCESS_COLOR_PRO,
    "ACCESS",
    ACCESS_COLOR_EPI,
    msg
  );

}

Console.prototype.debug = function(msg) {

  var DEBUG_COLOR_EPI, DEBUG_COLOR_PRO;

  if(CONFIG.__STDOUT__) {
    DEBUG_COLOR_EPI = "\x1b[0m";
    DEBUG_COLOR_PRO = "\x1b[33m";
  }

  if(CONFIG.__DEBUG__) {
    this.write(
      new Date().toISOString(),
      DEBUG_COLOR_PRO,
      "DEBUG",
      DEBUG_COLOR_EPI,
      msg
    );
  }

}

module.exports = new Console();

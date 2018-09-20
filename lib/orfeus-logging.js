/*
 * EIDA Manager - lib/orfeus-logging.js
 * 
 * Wrapper for EIDA Manager logging
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

// Native libs
const fs = require("fs");
const path = require("path");

const { createDirectory } = require("./lib/orfeus-util");
const CONFIG = require("./config");

var Logger = function() {

  /*
   * Class Logger
   * Wrapper class for writing messages to logfile or stdout
   */

  // Make sure the log directory exists
  createDirectory(path.dirname(CONFIG.LOGFILE));
 
  // Write to stdout or logfile
  if(CONFIG.__STDOUT__) {
    this.log = process.stdout;
  } else {
    this.log = fs.createWriteStream(CONFIG.LOGFILE, {"flags": "w"});
  }

}

Logger.prototype.write = function(array) {

  /*
   * Function Logger.write
   * Wrapper function for writing
   */

  this.log.write(Array.from(arguments).join(" ") + "\n");

}

Logger.prototype.fatal = function(msg) {

  /*
   * Function Logger.fatal
   * Method for logging a fatal level message
   */

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

Logger.prototype.error = function(msg) {

  /*
   * Function Logger.error
   * Method for logging an error level message
   */

  var ERROR_COLOR_EPI, ERROR_COLOR_PRO;

  if(CONFIG.__STDOUT__) {
    ERROR_COLOR_EPI = "\x1b[0m";
    ERROR_COLOR_PRO = "\x1b[31m";
  }

  var line = (CONFIG.__DEBUG__ ? msg.stack : msg.message);

  this.write(
    new Date().toISOString(),
    ERROR_COLOR_PRO,
    "ERROR",
    ERROR_COLOR_EPI,
    line
  );

}

Logger.prototype.info = function(msg) {

  /*
   * Function Logger.info
   * Method for logging an info level message
   */

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

Logger.prototype.access = function(msg) {

  /*
   * Function Logger.access
   * Method for logging a error level message
   */

  if(!CONFIG.__DEBUG__) {
    return;
  }

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

Logger.prototype.debug = function(msg) {

  /*
   * Function Logger.debug
   * Method for logging a error level message
   */

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

module.exports = new Logger();

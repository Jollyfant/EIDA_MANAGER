const CONFIG = require("./config");
const fs = require("fs");

var Console = function() {

  if(CONFIG.__STDOUT__) {
    this.log = process.stdout;
  } else {
    this.log = fs.createWriteStream(__dirname + "/orfeus-manager.log", {"flags": "w"});
  }

}

Console.prototype.write = function(array) {

  this.log.write(Array.from(arguments).join(" ") + "\n");

}

Console.prototype.fatal = function(msg) {

  if(CONFIG.__STDOUT__) {
    const FATAL_COLOR_EPI = "\x1b[0m";
    const FATAL_COLOR_PRO = "\x1b[31m";
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

  if(CONFIG.__STDOUT__) {
    const ERROR_COLOR_EPI = "\x1b[0m";
    const ERROR_COLOR_PRO = "\x1b[31m";
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

  if(CONFIG.__STDOUT__) {
    const INFO_COLOR_EPI = "\x1b[0m";
    const INFO_COLOR_PRO = "\x1b[34m";
  }

  this.write(
    new Date().toISOString(),
    INFO_COLOR_PRO,
    "INFO",
    INFO_COLOR_EPI,
    msg
  );

}

Console.prototype.debug = function(msg) {

  if(CONFIG.__STDOUT__) {
    const DEBUG_COLOR_EPI = "\x1b[0m";
    const DEBUG_COLOR_PRO = "\x1b[33m";
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

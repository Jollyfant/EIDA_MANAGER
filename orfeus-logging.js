const CONFIG = require("./config");

var Console = function() {

}

Console.prototype.error = function(msg) {
  console.log(new Date().toISOString(), "ERROR", msg);
}

Console.prototype.info = function(msg) {

  const INFO_COLOR_EPI = "\x1b[0m";
  const INFO_COLOR_PRO = "\x1b[34m";

  console.log(
    new Date().toISOString(),
    INFO_COLOR_PRO,
     "INFO",
    INFO_COLOR_EPI,
    msg
  );

}

Console.prototype.debug = function(msg) {

  const DEBUG_COLOR_EPI = "\x1b[0m";
  const DEBUG_COLOR_PRO = "\x1b[31m";

  if(CONFIG.__DEBUG__) {
    console.log(
      new Date().toISOString(),
      DEBUG_COLOR_PRO,
      "DEBUG",
      DEBUG_COLOR_EPI,
      msg
    );
  }

}

module.exports = new Console();

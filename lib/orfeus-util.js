/*
 * EIDA-Manager - lib/orfeus-util.js
 * 
 * Wrapper for utility functions
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const fs = require("fs");
const path = require("path");

function sum(array) {

  /*
   * Function sum
   * returns the sum of an array
   */

  if(array.length === 0) {
    return 0;
  }

  // If the array contains buffers return the length
  return array.map(function(x) {

    // Handle the length of buffers
    if(typeof(x) === "object") {
      return x.length;
    }

    return x;

  }).reduce(function(a, b) {
    return a + b;
  }, 0);

}

function createDirectory(filepath) {

  /*
   * Function createDirectory
   * Synchronously creates a directory for filepath if it does not exist
   */

  if(fs.existsSync(filepath)) {
    return;
  }

  var dirname = path.dirname(filepath);

  if(!fs.existsSync(dirname)) {
    createDirectory(dirname);
  }

  // Synchronously make the directory
  fs.mkdirSync(filepath);

}

module.exports = {
  sum,
  createDirectory
}

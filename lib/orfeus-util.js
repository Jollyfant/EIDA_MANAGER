function sum(array) {

  /* function sum
   * returns the sum of an array
   */

  if(array.length === 0) {
    return 0;
  }

  // If the array contains buffers return the length
  return array.map(function(x) {
    if(typeof(x) === "object") {
      return x.length;
    }
    return x;
  }).reduce(function(a, b) {
    return a + b;
  }, 0);

}

module.exports = {
  sum
}

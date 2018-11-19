/*
 * defaultUser.js
 * Adds the default administrator to the database
 * After adding the administrator, log in to the application and manage users 
 */

require("./require");

const MongoClient = require("mongodb");
const CONFIG = require("./config");
const Database = require("./lib/orfeus-database");
const { SHA256, randomId } = require("./lib/orfeus-crypto");

// You can change these parameters
const username = "Administrator";
const password = "password";

Database.connect(function(error) {

  if(error) {
    return console.log("Could not connect to database.");
  }

  var salt = randomId(32);

  Database.users().insertOne({
    "username": username,
    "password": SHA256(password + salt),
    "salt": salt,
    "network": {"code": "*", "start": new Date("1970-01-01T00:00:00")},
    "role": 0,
    "created": new Date(),
    "version": CONFIG.__VERSION__,
    "visited": null
  }, function(error) {

    if(error) {
      console.log("Error adding default user.");
    } else {
      console.log("Succesfully added default user.");
    }

    Database.close();

  });

});

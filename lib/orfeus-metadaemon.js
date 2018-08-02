/* EIDA Manager - module orfeus-metadaemon.js
 *
 * Background daemon for processing submitted StationXML
 *
 * Copyright ORFEUS Data Center, 2018
 * Author: Mathijs Koymans
 * License: MIT
 *
 */

// Native libs
const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

// Third party
const libxmljs = require("libxmljs");

// Self
const XSDSchema = require("./lib/orfeus-xml");
const database = require("./lib/orfeus-database");
const logger = require("./lib/orfeus-logging");
const ohttp = require("./lib/orfeus-http");
const { SHA256 } = require("./lib/orfeus-crypto");
const { validateMetadata } = require("./lib/orfeus-metadata");

const CONFIG = require("./config");

const E_CHILD_PROCESS = 1;

var GLOBAL_CALLBACK;

// Start the daemon
(metaDaemonInit = function() {

  var statusCodes = [
    database.METADATA_STATUS_PENDING,
    database.METADATA_STATUS_VALIDATED,
    database.METADATA_STATUS_CONVERTED,
    database.METADATA_STATUS_ACCEPTED
  ];

  // Also purge unnecessary files from the system
  if(CONFIG.METADATA.PURGE) {
    statusCodes.push(database.METADATA_STATUS_DELETED);
  }

  // Get all most recent network & station documents that must be processed
  var pipeline = [{
    "$group": {
      "_id": {
        "network": "$network",
        "station": "$station",
      },
      "id": {
        "$last": "$_id"
      },
      "created": {
        "$last": "$created"
      },
      "status": {
        "$last": "$status"
      },
      "filepath": {
        "$last": "$filepath"
      },
      "sha256": {
        "$last": "$sha256"
      }
    }
  }, {
    "$match": {
      "status": {
        "$in": statusCodes
      }
    }
  }];

  // Aggregate the results
  database.files().aggregate(pipeline).toArray(function(error, results) {

    logger.info("Metad initialized with " + results.length + " metadata for processing");

    // Define a global callback
    (GLOBAL_CALLBACK = function() {

      // No results: sleep
      if(results.length === 0) {
        return metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_MS);
      }

      // Get the next result
      var document = results.pop();

      // metaDaemonCallback document conversion, merging, and check for completion 
      switch(document.status) {
        case database.METADATA_STATUS_PENDING:
          return metadValidate(document);
        case database.METADATA_STATUS_VALIDATED:
          return metadConvert(document);
        case database.METADATA_STATUS_CONVERTED:
          return metadMerge(document);
        case database.METADATA_STATUS_ACCEPTED:
          return metadCheck(document);
        case database.METADATA_STATUS_DELETED:
          return metadPurge(document);
      }

    })();

  });

})();

function metaDaemonSleep(time) {

  /* function metaDaemonSleep
   * Put the daemon to sleep for some time
   */

  logger.info("metaDaemon is sleeping for " + time + " miliseconds");

  setTimeout(metaDaemonInit, time);

}

function getStatusInfo(status) {

  /* function getStatusInfo
   * Returns states info based on status enum
   */

  switch(status) {
    case database.METADATA_STATUS_REJECTED:
      return "METADATA_STATUS_REJECTED";
    case database.METADATA_STATUS_UNCHANGED:
      return "METADATA_STATUS_UNCHANGED";
    case database.METADATA_STATUS_PENDING:
      return "METADATA_STATUS_PENDING";
    case database.METADATA_STATUS_VALIDATED:
      return "METADATA_STATUS_VALIDATED";
    case database.METADATA_STATUS_CONVERTED:
      return "METADATA_STATUS_CONVERTED";
    case database.METADATA_STATUS_ACCEPTED:
      return "METADATA_STATUS_ACCEPTED";
    case database.METADATA_STATUS_COMPLETED:
      return "METADATA_STATUS_COMPLETED";
    case database.METADATA_STATUS_DELETED:
      return "METADATA_STATUS_DELETED";
    default:
      return "METADATA_STATUS_UNKNOWN";
  }

}

function metaDaemonCallback(document, status, error) {

  /* function metaDaemonCallback
   * Fired after an attempted metadMerge, metadConvert or metadCheck
   * sets new status for metadata
   */

  if(error === undefined) {
    error = null;
  }

  // Nothing changed: proceed
  if(status === database.METADATA_STATUS_UNCHANGED) {
    return GLOBAL_CALLBACK();
  }

  logger.info("Setting document " + document._id.network + "." + document._id.station + " to status " + getStatusInfo(status));

  var setObject = {
    "modified": new Date(),
    "status": status,
    "error": error
  }

  // When metadata is completed (available through FDSNWS)
  // we track the date & time of availability for provenance
  if(status === database.METADATA_STATUS_COMPLETED) {
    setObject.available = new Date();
  }

  // Update the status of the file and fire the global callback
  database.files().updateOne({"_id": document.id}, {"$set": setObject}, GLOBAL_CALLBACK);

}

function metadValidate(input) {

  /* function metadValidate
   * Validates the StationXML against the schema
   */

  const E_SCHEMA_VALIDATION = "The StationXML could not be validated against the XSD schema. Please check the syntax of the submitted file.";

  fs.readFile(input.filepath + ".stationXML", function(error, XMLString) {
 
    // Problem reading the file: skip
    if(error) {
      return metaDaemonCallback(input, database.METADATA_STATUS_UNCHANGED);
    }

    var XMLDocument = libxmljs.parseXml(XMLString);

    // Check against the schema
    if(!XMLDocument.validate(XSDSchema)) {
      return metaDaemonCallback(input, database.METADATA_STATUS_REJECTED, E_SCHEMA_VALIDATION);
    } 

    // Validate sanity of the document (e.g. sampling rate, FIR filters)
    try {
      validateMetadata(XMLDocument);
    } catch(exception) {
      return metaDaemonCallback(input, database.METADATA_STATUS_REJECTED, exception.message);
    }

    // Looks good
    metaDaemonCallback(input, database.METADATA_STATUS_VALIDATED);

  });

}

function comparePrototypes(networkPrototypeFile, networkStationFile, callback) {

  /* function comparePrototypes
   * Does simple validation of submitted file against the network prototype definition
   */

  function readSC3MLStart(data) {
  
    /* function comparePrototypes::readSC3MLStart
     * Extracts the network start time from an SC3ML document
     */

    var XMLDocument = libxmljs.parseXml(data);
    var namespace = XMLDocument.root().namespace().href();
  
    return XMLDocument.get("xmlns:Inventory", namespace).get("xmlns:network", namespace).get("xmlns:start", namespace).text();
  
  }

  const E_PROTOTYPE_MISSING = "Network prototype could not be found. Please contact an administrator.";
  const E_PROTOTYPE_CONFLICT_START = "The network prototype start time does not match the submitted time.";
  const E_INTERNAL_SERVER_ERROR = "The server experienced an unexpected error";

  // Read the network prototype and the submitted file asynchronously
  fs.readFile(networkPrototypeFile, function(error, data) {

    // The prototype is missing
    if(error) {
      return callback(E_PROTOTYPE_MISSING);
    }  

    var prototypeStart = readSC3MLStart(data);

    // Read the submitted station file
    fs.readFile(networkStationFile, function(error, data) {

      // Should not happen: it means the submitted file is missing
      if(error) {
        return callback(E_INTERNAL_SERVER_ERROR);
      }

      var networkStart = readSC3MLStart(data);

      // Compare properties of prototype & submission
      if(prototypeStart !== networkStart) {
        return callback(E_PROTOTYPE_CONFLICT_START);
      }

      callback(null);

    });

  });

}

function metadPurge(input) {

  /* function metadPurge
   * Checks whether the metadata can be removed from disk
   */

  function removeMetadata(x) {

    /* function removeMetadata
     * Purges metadata from filesystem
     */

    // Confirm we are deleting a SHA256 filename (64 characters in hex)
    if(path.basename(x).indexOf(".") === 64) {
      fs.unlink(x, Function.prototype);
    }

  }

  // Both the sc3ml and stationXML are saved to disk
  const EXTENSIONS = [".sc3ml", ".stationXML"];

  logger.info("metadPurge is requested for " + input._id.network + "." + input._id.station);

  database.files().deleteOne({"_id": input.id}, function(error, result) {

    if(error) {
      return metaDaemonCallback(input, database.METADATA_STATUS_UNCHANGED);
    }

    database.files().find({"sha256": input.sha256}).count(function(error, count) {

      if(error) {
        return metaDaemonCallback(input, database.METADATA_STATUS_UNCHANGED);
      }

      // Only delete the file from disk when there are no more file objects
      // referencing the file in the database
      if(count === 0) {
        EXTENSIONS.map(x => input.filepath + x).forEach(removeMetadata);
      }

      metaDaemonCallback(input, database.METADATA_STATUS_UNCHANGED);

    });

  });

}

function metadMerge(input) {

  /* function metadMerge
   * Attempts to merge new SC3ML station file with its full network prototype
   * These prototypes need to be created by data center operators
   */

  function getPrototype(network) {

    /* function comparePrototypes::getPrototype
     * Returns the SC3ML prototype file for a network
     */

    return path.join("static", "prototypes", network + ".sc3ml");

  }

  const E_PROTOTYPE_CONFLICT = "Could not merge metadata attribute against network prototype definition: ";

  logger.info("metadMerge is requested for " + input._id.network + "." + input._id.station);

  var networkPrototypeFile = getPrototype(input._id.network);
  var networkStationFile = input.filepath + ".sc3ml";

  // Own comparison between prototypes before giving it to SeisComP3 scinv merge
  comparePrototypes(networkPrototypeFile, networkStationFile, function(error) {

    // Propagate the error
    if(error) {
      return metaDaemonCallback(input, database.METADATA_STATUS_REJECTED, error);
    }

    var SEISCOMP_COMMAND = [
      "--asroot",
      "exec",
      "scinv",
      "merge",
      networkPrototypeFile,
      networkStationFile
    ];

    // Spawn subprocess
    const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

    var chunks = new Array();

    // Child process has closed
    convertor.on("close", function(code) {

      var stderr = Buffer.concat(chunks).toString();

      // Add the conflicting properties
      var conflictingProperties = new Array();

      if(stderr.includes("description")) {
        conflictingProperties.push("description");
      }

      // More generic error message
      if(stderr.includes("Conflicting definitions for network")) {
        stderr = E_PROTOTYPE_CONFLICT + (conflictingProperties.join(", ") || "unknown");
      }

      // Set status to rejected when failed
      if(code === E_CHILD_PROCESS) {
        metaDaemonCallback(input, database.METADATA_STATUS_REJECTED, stderr);
      } else {
        metaDaemonCallback(input, database.METADATA_STATUS_ACCEPTED);
      }

    });

    // Save stderr
    convertor.stderr.on("data", function(data) {
      chunks.push(data);
    });

  });

}

function metadCheck(input) {

  /* function metadCheck
   * metadChecks response against the FDSNWS Webservice to see if
   * a document has been included
   */

  logger.info("metadCheck is requested for " + input._id.network + "." + input._id.station);

  // Request instrument metadata
  const query = "?" + [
    "network=" + input._id.network,
    "station=" + input._id.station,
    "level=response"
  ].join("&");

  // Make a HTTP request to the webservice
  ohttp.request(CONFIG.FDSNWS.STATION.HOST + query, function(data) {

    if(data === null) {
      return metaDaemonCallback(input, database.METADATA_STATUS_UNCHANGED);
    }

    // Parse the document returned by FDSNWS
    var XMLDocument = libxmljs.parseXml(data);
    var namespace = XMLDocument.root().namespace().href();
    var network = XMLDocument.get("xmlns:Network", namespace);

    // When the SHA256 of the document matches that of the webservice
    // it has been included in the inventory and status is set to METADATA_STATUS_COMPLETED
    if(SHA256(network.toString()) === input.sha256) {
      metaDaemonCallback(input, database.METADATA_STATUS_COMPLETED);
    } else {
      metaDaemonCallback(input, database.METADATA_STATUS_UNCHANGED);
    }

  });

}

function metadConvert(input) {

  /* functon metadConvert
   * Attempts to converts StationXML to SC3ML
   */

  logger.info("metadConvert is requested for " + input._id.network + "." + input._id.station);

  const SEISCOMP_COMMAND = [
    "--asroot",
    "exec",
    "fdsnxml2inv",
    input.filepath + ".stationXML",
    "-f",
    input.filepath + ".sc3ml"
  ];

  // Spawn subproceed
  const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

  var chunks = new Array();

  // Child process has closed
  convertor.on("close", function(code) {

    var stderr = Buffer.concat(chunks).toString();

    if(stderr.includes("Conflicting definitions")) {
      //stderr = E_PROTOTYPE_CONFLICT;
    }

    // Set to rejected if the conversion fails
    if(code === E_CHILD_PROCESS) {
      metaDaemonCallback(input, database.METADATA_STATUS_REJECTED, stderr);
    } else {
      metaDaemonCallback(input, database.METADATA_STATUS_CONVERTED);
    }

  });

  // Save stderr
  convertor.stderr.on("data", function(data) {
    chunks.push(data);
  });

}

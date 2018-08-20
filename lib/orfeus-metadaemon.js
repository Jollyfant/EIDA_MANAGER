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
const { parsePrototype, validateMetadata } = require("./lib/orfeus-metadata");

const CONFIG = require("./config");

const E_CHILD_PROCESS = 1;

var GLOBAL_CALLBACK;

// Start the daemon
(metaDaemonInit = function() {

  var statusCodes = [
    database.METADATA_STATUS_PENDING,
    database.METADATA_STATUS_VALIDATED,
    database.METADATA_STATUS_CONVERTED
  ];

  // Also purge unnecessary files from the system
  if(CONFIG.METADATA.PURGE) {
    statusCodes.push(database.METADATA_STATUS_DELETED);
  }

  // Aggregate the results
  database.files().find({"status": {"$in": statusCodes}}).toArray(function(error, results) {

    logger.info("Metad initialized with " + results.length + " metadata for processing");

    // Define a global callback
    (GLOBAL_CALLBACK = function() {

      // No results: sleep
      if(results.length === 0) {
        return metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_MS);
      }

      // Get the next result again (prevent race conditions)
      database.files().findOne({"_id": results.pop()._id}, function(error, document) {

        if(error) {
          return metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_MS);
        }

        // metaDaemonCallback document conversion, merging, and check for completion 
        switch(document.status) {
          case database.METADATA_STATUS_PENDING:
            return metadValidate(document);
          case database.METADATA_STATUS_VALIDATED:
            return metadConvert(document);
          case database.METADATA_STATUS_CONVERTED:
            return metadMerge(document);
          case database.METADATA_STATUS_DELETED:
            return metadPurge(document);
        }

      });

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

  logger.info("Setting document " + document.network.code + "." + document.station + " to status " + getStatusInfo(status));

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
  database.files().updateOne({"_id": document._id}, {"$set": setObject}, GLOBAL_CALLBACK);

}

function metadValidate(document) {

  /* function metadValidate
   * Validates the StationXML against the schema
   */

  const E_SCHEMA_VALIDATION = "The StationXML could not be validated against the XSD schema. Please check the syntax of the submitted file.";

  fs.readFile(document.filepath + ".stationXML", function(error, XMLString) {
 
    // Problem reading the file: skip
    if(error) {
      return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
    }

    var XMLDocument = libxmljs.parseXml(XMLString);

    // Check against the schema
    if(!XMLDocument.validate(XSDSchema)) {
      return metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, E_SCHEMA_VALIDATION);
    } 

    // Validate sanity of the document (e.g. sampling rate, FIR filters)
    try {
      validateMetadata(XMLDocument);
    } catch(exception) {
      return metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, exception.message);
    }

    // Validate against the prototype
    comparePrototypes(XMLString, function(error) {
 
      if(error) {
        return metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, error);
      }

      metaDaemonCallback(document, database.METADATA_STATUS_VALIDATED);

    });

  });

}

function comparePrototypes(XMLDocument, callback) {

  /* function comparePrototypes
   * Does simple validation of submitted file against the network prototype definition
   */

  const E_PROTOTYPE_MISSING = "Network prototype could not be found. Please contact an administrator";
  const E_PROTOTYPE_CONFLICT_END = "The submitted network end time conflicts with the network prototype definition";
  const E_PROTOTYPE_CONFLICT_RESTRICTED = "The submitted network restricted status conflicts with the network prototype definition";
  const E_INTERNAL_SERVER_ERROR = "The server experienced an unexpected error";

  var thing = parsePrototype(XMLDocument);

  // A network is identifier by its code, start & end time
  database.prototypes().find({"network": thing.network}).sort({"created": database.DESCENDING}).limit(1).toArray(function(error, documents) {

    if(error) {
      return callback(E_INTERNAL_SERVER_ERROR);
    }

    if(documents.length === 0) {
      return callback(E_PROTOTYPE_MISSING);
    }

    var document = documents.pop();

    // Check if end time matches
    if(document.network.end !== thing.network.end) {
      return callback(E_PROTOTYPE_CONFLICT_END);
    }

    // Check if the restricted status matches
    if(document.restricted !== thing.restricted) {
      return callback(E_PROTOTYPE_CONFLICT_RESTRICTED);
    }

    callback(null);

  });

}

function metadPurge(document) {

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

  logger.info("metadPurge is requested for " + document.network.code + "." + document.station);

  database.files().deleteOne({"_id": document._id}, function(error, result) {

    if(error) {
      return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
    }

    database.files().find({"sha256": document.sha256}).count(function(error, count) {

      if(error) {
        return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
      }

      // Only delete the file from disk when there are no more file objects
      // referencing the file in the database
      if(count === 0) {
        EXTENSIONS.map(x => document.filepath + x).forEach(removeMetadata);
      }

      metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);

    });

  });

}

function metadMerge(document) {

  /* function metadMerge
   * Attempts to merge new SC3ML station file with its full network prototype
   * These prototypes need to be created by data center operators
   */

  function getPrototype(hash) {

    /* function getPrototype
     * Returns the SC3ML prototype file for a network
     */

    return path.join("metadata", "prototypes", hash + ".stationXML");

  }

  const TEMPORARY_PROTOTYPE = getPrototype("temporary");
  const E_PROTOTYPE_CONFLICT = "Could not merge metadata attribute against network prototype definition. Please contact an administrator: ";
  const E_PROTOTYPE_MISSING = "The network prototype definition is missing";

  logger.info("metadMerge is requested for " + document.network.code + "." + document.station);

  database.prototypes().find({"network.code": document.network.code, "network.start": document.network.start}).sort({"created": database.DESCENDING}).limit(1).toArray(function(error, prototypes) {

    if(error) {
      return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
    }

    if(prototypes.length === 0) {
      return metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, E_PROTOTYPE_MISSING);
    }

    var prototype = prototypes.pop();

    const SEISCOMP_COMMAND = [
      "exec",
      "fdsnxml2inv",
       getPrototype(prototype.sha256),
      "-f",
      TEMPORARY_PROTOTYPE
    ];

    const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

    // Child process has closed
    convertor.on("close", function(code) {

      // Set to rejected if the conversion fails
      if(code === E_CHILD_PROCESS) {
        return metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, E_PROTOTYPE_MISSING);
      }

      logger.info("Network prototype has been temporarily converted to SC3ML");

      // Attempt to merge the station SC3ML with the converted prototype
      var SEISCOMP_COMMAND = [
        "exec",
        "scinv",
        "merge",
        document.filepath + ".sc3ml",
        TEMPORARY_PROTOTYPE
      ];

      // Spawn subprocess
      const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

      var chunks = new Array();

      // Child process has closed
      convertor.on("close", function(code) {

        var stderr = Buffer.concat(chunks).toString();

        // Set status to rejected when failed
        if(code === E_CHILD_PROCESS) {
          metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, E_PROTOTYPE_CONFLICT + stderr);
        } else {
          metaDaemonCallback(document, database.METADATA_STATUS_ACCEPTED);
        }

      });

      // Save stderr
      convertor.stderr.on("data", function(data) {
        chunks.push(data);
      });

    });

  });

}

function metadConvert(document) {

  /* functon metadConvert
   * Attempts to converts StationXML to SC3ML
   */

  logger.info("metadConvert is requested for " + document.network.code + "." + document.station);

  const SEISCOMP_COMMAND = [
    "exec",
    "fdsnxml2inv",
    document.filepath + ".stationXML",
    "-f",
    document.filepath + ".sc3ml"
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
      metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, stderr);
    } else {
      metaDaemonCallback(document, database.METADATA_STATUS_CONVERTED);
    }

  });

  // Save stderr
  convertor.stderr.on("data", function(data) {
    chunks.push(data);
  });

}

/*
 * EIDA Manager - metadaemon container
 *
 * Background daemon for processing submitted StationXML
 *
 * Copyright ORFEUS Data Center, 2018
 * Author: Mathijs Koymans
 * License: MIT
 *
 */

"use strict";

// Make require relative to the root directory
require("./require");

// Native libs
const fs = require("fs");
const path = require("path");

// Self
const XSDSchema = require("./lib/orfeus-xml");
const database = require("./lib/orfeus-database");
const logger = require("./lib/orfeus-logging");
const { parsePrototype, validateMetadata } = require("./lib/orfeus-metadata");
const seisComP3 = require("./lib/orfeus-seiscomp");

// Configuration
const CONFIG = require("./config");

var GLOBAL_CALLBACK;

var metaDaemonInit = function() {

  /*
   * Function metaDaemonInit
   * Initializes the metadata processing pipeline
   */

  // Status codes that need metadaemon attention
  var statusCodes = [
    database.METADATA_STATUS_PENDING,
    database.METADATA_STATUS_VALIDATED,
    database.METADATA_STATUS_CONVERTED
  ];

  // Also purge unnecessary (terminated) files from the system
  if(CONFIG.METADATA.PURGE) {
    statusCodes.push(database.METADATA_STATUS_DELETED);
  }

  // Define a global callback
  (GLOBAL_CALLBACK = function() {

    // Get the next result again (prevent race conditions)
    database.files().findOne({"status": {"$in": statusCodes}}, function(error, document) {

      // Put the metadaemon to sleep
      if(error || document === null) {
        return metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_SECONDS);
      }

      // Map the document status to the processing pipeline 
      switch(document.status) {
        case database.METADATA_STATUS_PENDING:
          return metadValidate(document);
        case database.METADATA_STATUS_VALIDATED:
          return metadConvert(document);
        case database.METADATA_STATUS_CONVERTED:
          return metadMerge(document);
        case database.METADATA_STATUS_DELETED:
          return metadPurge(document);
        default:
          throw("Unknown document status received: " + document.status);
      }

    });

  })();

}

function metaDaemonSleep(time) {

  /*
   * Function metaDaemonSleep
   * Put the daemon to sleep for N seconds
   */

  logger.info("metaDaemon is sleeping for " + time + " seconds");

  setTimeout(metaDaemonInit, 1E3 * time);

}

function getStatusInfo(status) {

  /*
   * Function getStatusInfo
   * Returns states info based on status enumeration
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

  /*
   * Function metaDaemonCallback
   * Fired after an attempted metadMerge, metadConvert and sets new status for metadata
   */

  // If not defined set to null
  if(error === undefined) {
    error = null;
  }

  // Nothing has changed: proceed
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
  // we track the date & time of availability for data provenance
  if(status === database.METADATA_STATUS_COMPLETED) {
    setObject.available = new Date();
  }

  // Update the status of the file and fire the global callback
  database.files().updateOne({"_id": document._id}, {"$set": setObject}, GLOBAL_CALLBACK);

}

function metadValidate(document) {

  /*
   * Function metadValidate
   * Validates the StationXML against the schema
   */

  logger.info("metadValidate is requested for " + document.network.code + "." + document.station);

  // Read the file from disk
  fs.readFile(document.filepath + ".stationXML", function(error, XMLString) {
 
    // Problem reading the file: skip
    if(error) {
      return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
    }

    // Validate sanity of the document (e.g. sampling rate, FIR filters)
    try {
      validateMetadata(XMLString);
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

  /*
   * Function comparePrototypes
   * Does simple validation of submitted file against the network prototype definition
   */

  const E_PROTOTYPE_MISSING = "The network prototype could not be found. Please contact an administrator";
  const E_PROTOTYPE_CONFLICT_END = "The submitted network end time conflicts with the network prototype definition";
  const E_PROTOTYPE_CONFLICT_RESTRICTED = "The submitted network restricted status conflicts with the network prototype definition";
  const E_INTERNAL_SERVER_ERROR = "The server experienced an unexpected error";

  var thing = parsePrototype(XMLDocument);

  // A network is identifier by its code, start & end time
  database.prototypes().find({"network": thing.network}).sort({"created": database.DESCENDING}).limit(1).toArray(function(error, documents) {

    if(error) {
      return callback(E_INTERNAL_SERVER_ERROR);
    }

    // The network prototype could not be found in the database
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

  /*
   * Function metadPurge
   * Purges metadata that was rejected or terminated from database and disk
   */

  function removeMetadata(x) {

    /*
     * Function removeMetadata
     * Purges metadata from filesystem
     */

    // Confirm we are deleting a SHA256 filename (64 characters in hex)
    if(path.basename(x).indexOf(".") === 64) {
      fs.unlink(x, Function.prototype);
    }

  }

  // Both the sc3ml and stationXML are saved to disk
  const EXTENSIONS = [
    ".sc3ml",
    ".stationXML"
  ];

  logger.info("metadPurge is requested for " + document.network.code + "." + document.station);

  // Delete the document entry from the database
  database.files().deleteOne({"_id": document._id}, function(error, result) {

    if(error) {
      return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
    }

    // Check if there is another document with this hash
    // In that case DO NOT delete it from disk
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

  /*
   * Function metadMerge
   * Attempts to merge new SC3ML station file with its full network prototype
   * These prototypes need to be created by data center operators
   */

  function getPrototypeFilename(hash) {

    /*
     * Function getPrototypeFilename
     * Returns the SC3ML prototype file for a network
     */

    return path.join("metadata", "prototypes", hash + ".stationXML");

  }

  const TEMPORARY_PROTOTYPE = getPrototypeFilename("temporary");
  const E_PROTOTYPE_CONFLICT = "Could not merge metadata attribute against network prototype definition. Please contact an administrator: ";
  const E_PROTOTYPE_MISSING = "The network prototype definition is missing";

  logger.info("metadMerge is requested for " + document.network.code + "." + document.station);

  // Get the active prototype
  database.getActivePrototype(document.network, function(error, prototypes) {

    if(error) {
      return metaDaemonCallback(document, database.METADATA_STATUS_UNCHANGED);
    }

    if(prototypes.length === 0) {
      return metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, E_PROTOTYPE_MISSING);
    }

    var prototype = prototypes.pop();
    var files = new Array(document.filepath + ".sc3ml", prototype.filepath + ".sc3ml");

    // Attempt to merge without output
    seisComP3.mergeSC3ML(files, null, function(stderr, code) {

      // Set status to rejected when failed
      if(code !== 0) {
        metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, E_PROTOTYPE_CONFLICT + stderr);
      } else {
        metaDaemonCallback(document, database.METADATA_STATUS_ACCEPTED);
      }

    });

  });

}

function metadConvert(document) {

  /*
   * Functon metadConvert
   * Attempts to converts StationXML to SC3ML
   */

  logger.info("metadConvert is requested for " + document.network.code + "." + document.station);

  var input = document.filepath + ".stationXML";
  var output = document.filepath + ".sc3ml";

  seisComP3.convertSC3ML(input, output, function(stderr, code) {

    // Set to rejected if the conversion fails
    if(code !== 0) {
      metaDaemonCallback(document, database.METADATA_STATUS_REJECTED, stderr);
    } else {
      metaDaemonCallback(document, database.METADATA_STATUS_CONVERTED);
    }

  });

}

function __init__() {

  /*
   * Function __init__
   * Initializes the metadaemon after connecting to the MongoDB database
   */

  const RETRY_TIMEOUT_MS = 1E3;

  database.connect(function(error) {
  
    if(error) {
      logger.fatal(error);
      return setTimeout(__init__, RETRY_TIMEOUT_MS);
    }
  
    metaDaemonInit();
  
  });

}

if(require.main === module) {
  
  // Init the Metadaemon
  __init__();

}

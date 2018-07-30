/* Module orfeus-metadaemon
 *
 * Background daemon for processing submitted StationXML
 */

const fs = require("fs");
const path = require("path");
const childProcess = require("child_process");

const libxmljs = require("libxmljs");

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

  // Get all most recent network & station documents
  // That need to be worked on
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
        "$in": [
          database.METADATA_STATUS_PENDING,
          database.METADATA_STATUS_VALIDATED,
          database.METADATA_STATUS_CONVERTED,
          database.METADATA_STATUS_ACCEPTED
        ]
      }
    }
  }];

  // Aggregate the results
  database.files().aggregate(pipeline).toArray(function(error, results) {

    if(error) {
      return metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_MS);
    }

    logger.info("Metad initialized with " + results.length + " metadata for processing");

    // Define a global callback
    (GLOBAL_CALLBACK = function() {

      // Put the daemon to sleep
      if(results.length === 0) {
        return metadFull(function() {
          metaDaemonSleep(CONFIG.METADATA.DAEMON.SLEEP_INTERVAL_MS);
        });
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
    case database.METADATA_STATUS_DELETED:
      return "METADATA_STATUS_DELETED";
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

  var setQuery = {
    "$set": {
      "modified": new Date(),
      "status": status,
      "error": error
    }
  }

  // Update the status of the file and fire the global callback
  database.files().updateOne({"_id": document.id}, setQuery, GLOBAL_CALLBACK);

}

function getPrototype(network) {

  /* function getPrototype
   * Returns the SC3ML prototype file for a network
   */

  return path.join("prototypes", network + ".sc3ml");

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

function metadMerge(input) {

  /* function metadMerge
   * Attempts to merge new SC3ML station file with its full network prototype
   * These prototypes need to be created by Data Center operators
   */

  const E_PROTOTYPE_MISSING = "Network prototype could not be found. Please contact an administrator.";

  logger.info("metadMerge is requested for " + input._id.network + "." + input._id.station);

  var networkPrototypeFile = getPrototype(input._id.network);

  // Check if the prototype exists
  fs.stat(networkPrototypeFile, function(error, stats) {

    // Administrator should add the prototype
    if(error) {
      return metaDaemonCallback(input, database.METADATA_STATUS_REJECTED, E_PROTOTYPE_MISSING);
    }

    var SEISCOMP_COMMAND = [
      "--asroot",
      "exec",
      "scinv",
      "merge",
      networkPrototypeFile,
      input.filepath + ".sc3ml"
   ];

    // Spawn subprocess
    const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

    var chunks = new Array();

    // Child process has closed
    convertor.on("close", function(code) {

      var stderr = Buffer.concat(chunks).toString();

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

function metadFull(callback) {

  /* Function metadFull
   * Attempts to merge the entire inventory based on the most recent
   * ACCEPTED or COMPLETED metadata
   */

  logger.info("metaDaemon is merging the entire inventory.");

  // The pipeline for getting all metadata
  const pipeline = [{
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
      }
    }
  }, {
    "$match": {
        "status": {
          "$in": [
            database.METADATA_STATUS_ACCEPTED,
            database.METADATA_STATUS_COMPLETED
          ]
        }
      }
  }];

  // Query the database
  database.files().aggregate(pipeline).toArray(function(error, documents) {

    // Problem or no documents to merge
    if(error || documents.length === 0) {
      return callback();
    }

    // Get the sc3ml files
    documents = documents.map(function(x) {
      return x.filepath + ".sc3ml";
    });

    logger.info("metaDaemon is merging " + documents.length + " inventory files."); 

    var SEISCOMP_COMMAND = [
      "--asroot",
      "exec",
      "scinv",
      "merge"
    ];

    // Add all documents to be merged
    SEISCOMP_COMMAND = SEISCOMP_COMMAND.concat(documents);
    SEISCOMP_COMMAND = SEISCOMP_COMMAND.concat(["-o", "./metadata/full.xml"]);

    // Spawn subprocess
    const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

    // Prints progress (to stderr???)
    convertor.stderr.on("data", function(data) {
      //console.log(data.toString());
    });

    // Child process has closed
    convertor.on("close", function(code) {
      logger.info("metaDaemon merged full inventory. Exited with status code " + code + ".");
      callback();
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

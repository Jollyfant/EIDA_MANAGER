/* lib/orfeus-metadata.js
 * 
 * Wrapper for StationXML Metadata validation functions
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

// Native libs
const path = require("path");

// Third-party dependencies
const libxmljs = require("libxmljs");

// Custom
const XSDSchema = require("./lib/orfeus-xml");
const logger = require("./lib/orfeus-logging");
const { SHA256 } = require("./lib/orfeus-crypto.js");
const { sum } = require("./lib/orfeus-util");
const CONFIG = require("./config");

function readAttribute(element, property) {

  /*
   * Function readAttribute
   * Reads an attribute from an element or null
   */

  if(element.attr(property) === null) {
    return null;
  }

  return element.attr(property).value();

}

function convertDate(date) {

  /*
   * Function convertDate
   * Converts string to date or null
   */

  if(date === null) {
    return null;
  }

  return new Date(date);

}

function parsePrototype(XMLString) {

  /*
   * Function parsePrototype
   * Parses a stationXML network element
   */

  function getPrototypeFile(sha256) {

    /*
     * Function parsePrototype::getPrototypeFile
     * Returns the prototype file
     */

    return path.join("metadata", "prototypes", sha256);

  }

  // Parse the document & get the namespace
  var XMLDocument = libxmljs.parseXml(XMLString);
  var namespace = XMLDocument.root().namespace().href();

  if(!XMLDocument.validate(XSDSchema)) {
    throw new Error("Error validating network prototype against schema.");
  }

  // Check if only one network definition is present
  if(XMLDocument.find("xmlns:Network", namespace).length === 0) {
    throw new Error("No network element defined in prototype.");
  }
  if(XMLDocument.find("xmlns:Network", namespace).length > 1) {
    throw new Error("Multiple network elements defined in prototype.");
  }

  // Get the namespace
  var network = XMLDocument.get("xmlns:Network", namespace);
  var sha256 = SHA256(network.toString().replace(" xmlns=\"\"", ""));

  // Return a network prototype object 
  return {
    "network": {
      "code": network.attr("code").value(),
      "start": convertDate(readAttribute(network, "startDate"))
    },
    "end": convertDate(readAttribute(network, "endDate")),
    "restricted": (readAttribute(network, "restrictedStatus") === "closed"),
    "description": network.get("xmlns:Description", namespace).text(),
    "created": new Date(),
    "sha256": sha256,
    "filepath": getPrototypeFile(sha256)
  }

}

function validateMetadata(XMLDocument) {

  /*
   * Function validateMetadata
   * Server side validation of StationXML metadata
   */

  const NETWORK_REGEXP = new RegExp(/^[a-z0-9]{1,2}$/i);
  const STATION_REGEXP = new RegExp(/^[a-z0-9]{1,5}$/i);
  const CHANNEL_REGEXP = new RegExp(/^[a-z0-9]{1,3}$/i);
  const GAIN_TOLERNACE_PERCENT = 0.001;

  var namespace = XMLDocument.root().namespace().href();

  XMLDocument.find("xmlns:Network", namespace).forEach(function(network) {

    var networkCode = network.attr("code").value();

    // Confirm network & station identifiers
    if(!NETWORK_REGEXP.test(networkCode)) {
      throw new Error("Invalid network code.");
    }

    network.find("xmlns:Station", namespace).forEach(function(station) {

      var stationCode = station.attr("code").value();

      if(!STATION_REGEXP.test(stationCode)) {
        throw new Error("Invalid station code.");
      }

      var channels = station.find("xmlns:Channel", namespace);

      if(channels.length === 0) {
        throw new Error("Channel information is missing.");
      }

      channels.forEach(function(channel) {

        var channelCode = channel.attr("code").value();

        if(!CHANNEL_REGEXP.test(channelCode)) {
          throw new Error("Invalid channel code: " + channelCode + ".");
        }

        // Skip the validation of LOG channels
        if(channelCode === "LOG") {
          return;
        }

        var sampleRate = Number(channel.get("xmlns:SampleRate", namespace).text())

        if(isNaN(sampleRate) || sampleRate === 0) {
          throw new Error("Invalid sample rate: " + sampleRate + ".");
        }

        var response = channel.find("xmlns:Response", namespace);

        if(response.length === 0) {
          throw new Error("Required response element is missing.");
        }

        if(response.length !== 1) {
          throw new Error("Multiple response elements are included.");
        }

        var stages = response[0].find("xmlns:Stage", namespace);

        if(stages.length === 0) {
          throw new Error("No response stages included in inventory.");
        }

        var perStageGain = 1;

        stages.forEach(function(stage) {

          perStageGain = perStageGain * Number(stage.get("xmlns:StageGain", namespace).get("xmlns:Value", namespace).text());

          stage.find("xmlns:FIR", namespace).forEach(function(FIRStage) {
            validateFIRStage(FIRStage, namespace);
          });

        });

        var instrumentSensitivity = Number(response[0].get("xmlns:InstrumentSensitivity", namespace).get("xmlns:Value", namespace).text());

        // Validate stage calculated & reported gains
        if(1 - (Math.max(instrumentSensitivity, perStageGain) / Math.min(instrumentSensitivity, perStageGain)) > GAIN_TOLERNACE_PERCENT) {
          throw new Error("The computed and reported total stage gain are different.");
        }

      });

    });

  });

}

function validateFIRStage(FIRStage, namespace) {

  /*
   * Function validateFIRStage
   * Validates StationXML FIR Stage
   */

  const FIR_TOLERANCE = 0.02;

  // Confirm FIR Stage input units as COUNTS
  if(FIRStage.get("xmlns:InputUnits", namespace).get("xmlns:Name", namespace).text() !== "COUNTS") {
    throw new Error("FIR Stage input units invalid.");
  }

  // Confirm FIR Stage output units as COUNTS
  if(FIRStage.get("xmlns:OutputUnits", namespace).get("xmlns:Name", namespace).text() !== "COUNTS") {
    throw new Error("FIR Stage output units invalid.");
  }

  var FIRSum = sum(FIRStage.find("xmlns:NumeratorCoefficient", namespace).map(x => Number(x.text())));

  // Symmetry specified: FIR coefficients are symmetrical (double the sum)
  if(FIRStage.get("xmlns:Symmetry", namespace).text() !== "NONE") {
    FIRSum = 2 * FIRSum;
  }

  // Check if the FIR coefficient sum is within tolerance
  if(Math.abs(1 - FIRSum) > FIR_TOLERANCE) {
    throw new Error("Invalid FIR Coefficient Sum (" + Math.abs(1 - FIRSum).toFixed(4) + ").");
  }

}

function getRestriction(bool) {

  /*
   * Function setRestriction
   * Sets the nodes restrictedStatus attribute to closed 
   */

  return bool ? "closed" : "open";

}

function updateStationXML(prototype, files) {

  /*
   * Function updateStationXML
   * Updates existing stationXML to match new prototype definition
   * and updated description, restrictedStatus
   */

  // Extra properties that will be set on the document
  var properties = {
    "netRestricted": prototype.restricted,
    "restricted": prototype.restricted,
    "description": prototype.description,
    "end": prototype.end,
    "code": prototype.network.code,
    "start": prototype.network.start
  }

  // Delegate to another routine
  return splitStationXML(files, properties);

}

function setEndDate(node, endDate) {

  /*
   * Function setEndDate
   * Sets end date attribute of node
   */

  // Overwrite the end date with the submitted end date
  if(endDate !== null) {
    return node.attr("endDate", endDate.toISOString());
  }

  // If null attempt to remove
  if(node.attr("endDate") !== null) {
    node.attr("endDate").remove();
  }

}

function setChannelRestriction(channels, restricted) {

  /*
   * Function setChannelRestriction
   * Sets channels for a station to given restricted status
   */

  channels.forEach(function(channel) {
    channel.attr("restrictedStatus", getRestriction(restricted));
  });

}

function splitStationXML(files, properties) {

  /*
   * Function splitStationXML
   * Validated and splits stationXML per station
   */

  const FDSN_SENDER = "ORFEUS";
  const FDSN_SOURCE = "ORFEUS Manager Upload";
  const FDSN_MODULE = "ORFEUS Manager " + CONFIG.__VERSION__;
  const FDSN_NAMESPACE = "http://www.fdsn.org/xml/station/1";
  const FDSN_STATION_VERSION = "1.0";

  // Collect a hash map of stations
  var stationHashMap = new Object();

  // Whether the stations must be set to restricted
  files.forEach(function(file) {

    // Convert to libxmljs object
    var XMLDocument = libxmljs.parseXml(file);

    // Validate the entire against the schema
    if(!XMLDocument.validate(XSDSchema)) {
      throw new Error("Error validating FDSNStationXML against schema.");
    }

    // Get the namespace & schema version of document
    var namespace = XMLDocument.root().namespace().href();
    var schemaVersion = XMLDocument.root().attr("schemaVersion").value();

    // Confirm namespace
    if(namespace !== FDSN_NAMESPACE) {
      throw new Error("Invalid FDSNStationXML namespace.");
    }

    // Confirm version
    if(schemaVersion !== FDSN_STATION_VERSION) {
      throw new Error("Invalid FDSNStationXML version.");
    }

    // Split entries by Network / Station
    XMLDocument.find("xmlns:Network", namespace).forEach(function(network) {

      var networkCode = network.attr("code").value();
      var networkStart = convertDate(readAttribute(network, "startDate"));

      // Confirm this is the users network
      if(networkCode !== properties.code || networkStart.toISOString() !== properties.start.toISOString()) {
        throw new Error("User does not own network rights.");
      }

      // Get all the stations
      network.find("xmlns:Station", namespace).forEach(function(station) {

        var stationCode = station.attr("code").value();

        if(!stationHashMap.hasOwnProperty(stationCode)) {
          stationHashMap[stationCode] = new Array();
        }

        // Check if station is set to restricted
        var sRestricted = properties.restricted || (readAttribute(station, "restrictedStatus") === "closed");

        // Set the station (and derived channel) restricted status logically 
        station.attr("restrictedStatus", getRestriction(sRestricted));

        // Propogate station to the channel restriction
        setChannelRestriction(station.find("xmlns:Channel", namespace), sRestricted);

        logger.debug("Extracting station " + networkCode + "." + stationCode + " from document");

        // Namespace must be removed this way (known bug in libxmljs)
        // And then replaced out in the string representation
        station.namespace("");

        // Add the station element to the hashmap
        stationHashMap[stationCode].push(station);

      });

    });

  });

  var XMLDocuments = new Array();

  // For each station in the hash map create a new document
  Object.keys(stationHashMap).forEach(function(stationCode) {

    // Create a new XML document
    var stationXMLDocument = new libxmljs.Document("1.0", "UTF-8");

    // Add FDSNStationXML attributes
    var stationXMLRoot = stationXMLDocument.node("FDSNStationXML").attr({
      "xmlns": FDSN_NAMESPACE,
      "schemaVersion": FDSN_STATION_VERSION
    });

    // Add new properties to the root
    stationXMLRoot.node("Source", FDSN_SOURCE);
    stationXMLRoot.node("Sender", FDSN_SENDER);
    stationXMLRoot.node("Module", FDSN_MODULE);
    stationXMLRoot.node("Created", new Date().toISOString());

    // Create a network node
    stationXMLNetwork = stationXMLRoot.node("Network");

    // Add prototype attributes
    stationXMLNetwork.attr("restrictedStatus", getRestriction(properties.netRestricted));
    stationXMLNetwork.attr("code", properties.code);
    stationXMLNetwork.attr("startDate", properties.start.toISOString());

    // Set the end date to match that of the prototype (or remove it!)
    setEndDate(stationXMLNetwork, properties.end)

    // Add the prototype desription
    stationXMLNetwork.node("Description", properties.description);

    var nChannels = 0;
    var stationHashes = new Array();

    // Add each station to the document
    stationHashMap[stationCode].forEach(function(station) {

      stationXMLNetwork.addChild(station);

      // Add the number of channels per station
      nChannels = nChannels + station.find("xmlns:Channel", FDSN_NAMESPACE).length;

    });

    // Do not format the string when writing to disk
    // Otherwise we cannot calculate the hash because libxmljs refuses to work above
    // We must do a string replacement of the namespace because of a bug in libxmljs
    var XMLString = stationXMLDocument.toString(false).replace(new RegExp(" xmlns=\"\"", "g"), "");

    // XOR the hashes of the station elements 
    var documentHash = SHA256(stationXMLNetwork.toString().replace(new RegExp(" xmlns=\"\"", "g"), ""));

    XMLDocuments.push({
      "data": XMLString,
      "metadata": {
        "nChannels": nChannels, 
        "network": {
          "code": properties.code,
          "start": properties.start,
          "end": properties.end
        },
        "station": stationCode,
        "filepath": path.join(CONFIG.METADATA.PATH, properties.code, stationCode),
        "id": properties.code + "." + stationCode,
        "size": XMLString.length,
        "sha256": documentHash
      }

    });

  });
  
  return XMLDocuments;

}

module.exports = {
  splitStationXML,
  validateMetadata,
  parsePrototype,
  updateStationXML
}

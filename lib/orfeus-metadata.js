/* lib/orfeus-metadata.js
 * 
 * Wrapper for StationXML Metadata validation functions
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

const path = require("path");

const libxmljs = require("libxmljs");

const XSDSchema = require("./lib/orfeus-xml");
const logger = require("./lib/orfeus-logging");
const { SHA256 } = require("./lib/orfeus-crypto.js");
const { sum } = require("./lib/orfeus-util");

const CONFIG = require("./config");

function readAttribute(element, property) {

  /* function parsePrototype::readAttribute
   * Reads an attribute from an element or null
   */

  if(element.attr(property) === null) {
    return null;
  }

  return element.attr(property).value();

}

function convertDate(date) {

  if(date === null) {
    return null;
  }

  return new Date(date);

}

function parsePrototype(XMLString) {

  /* function parsePrototype
   * Parses a stationXML network element
   */

  var XMLDocument = libxmljs.parseXml(XMLString);

  // Get the namespace
  var namespace = XMLDocument.root().namespace().href();
  var network = XMLDocument.get("xmlns:Network", namespace);

  // Return a network prototype object 
  return {
    "network": {
      "code": network.attr("code").value(),
      "start": convertDate(readAttribute(network, "startDate")),
      "end": convertDate(readAttribute(network, "endDate"))
    },
    "restricted": network.attr("restrictedStatus").value() === "closed",
    "description": network.get("xmlns:Description", namespace).text(),
    "created": new Date(),
    "sha256": SHA256(network.toString().replace(" xmlns=\"\"", ""))
  }

}

function validateMetadata(XMLDocument) {

  /* function validateMetadata
   * Server side validation of StationXML metadata
   */

  const NETWORK_REGEXP = new RegExp(/^[a-z0-9]{1,2}$/i);
  const STATION_REGEXP = new RegExp(/^[a-z0-9]{1,5}$/i);
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

        // Skip validation of LOG channels
        if(channelCode === "LOG") {
          return;
        }

        var sampleRate = Number(channel.get("xmlns:SampleRate", namespace).text())

        if(isNaN(sampleRate) || sampleRate === 0) {
          throw new Error("Invalid sample rate.");
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

  /* function validateFIRStage
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

  var FIRSum = sum(FIRStage.find("xmlns:NumeratorCoefficient", namespace).map(function(FIRCoefficient) {
    return Number(FIRCoefficient.text());
  }));

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

  /* function setRestriction
   * Sets the nodes restrictedStatus attribute to closed 
   */

  return bool ? "closed" : "open";

}

function updateStationXML(prototype, files) {

  /* function updateStationXML
   * Updates existing stationXML to match new prototype definition
   * and updated description, restrictedStatus
   */

  // Set up files as expected by the split routine
  var files = files.map(x => ({"type": "file", "data": x}));

  var properties = {
    "netRestricted": {"value": prototype.restricted},
    "restricted": {"value": prototype.restricted},
    "description": {"value": prototype.description}
  }

  // Delegate to another routine
  return splitStationXML(files, properties);

}

function splitStationXML(files, properties) {

  /* function splitStationXML
   * Validated and splits stationXML per station
   */

  const FDSN_SENDER = "ORFEUS";
  const FDSN_SOURCE = "ORFEUS Manager Upload";
  const FDSN_MODULE = "ORFEUS Manager " + CONFIG.__VERSION__;
  const FDSN_STATION_VERSION = "1.0";

  // Collection of documents to be written
  var XMLDocuments = new Array();

  // Whether the stations must be set to restricted
  for(var i = 0; i < files.length; i++) {

    // Convert to libxmljs object
    var XMLDocument = libxmljs.parseXml(files[i].data);

    // Validate the entire against the schema
    if(!XMLDocument.validate(XSDSchema)) {
      throw new Error("Error validating FDSNStationXML against schema.");
    }

    // Get the namespace & schema version of document
    var namespace = XMLDocument.root().namespace().href();
    var schemaVersion = XMLDocument.root().attr("schemaVersion").value();

    // Confirm version
    if(schemaVersion !== FDSN_STATION_VERSION) {
      throw new Error("Invalid FDSNStationXML version.");
    }

    // Split entries by Network / Station
    XMLDocument.find("xmlns:Network", namespace).forEach(function(network) {

      // The network must be set to restricted
      if(properties.netRestricted !== undefined) {
        network.attr("restrictedStatus", getRestriction(properties.netRestricted.value));
      }

      // Set the network description
      if(properties.description !== undefined) {
        network.get("xmlns:Description", namespace).text(properties.description.value);
      }

      var networkCode = network.attr("code").value();
      var networkStart = convertDate(readAttribute(network, "startDate"));
      var networkEnd = convertDate(readAttribute(network, "startEnd"));

      network.find("xmlns:Station", namespace).forEach(function(station) {

        // Set the station (and derived channel) restricted status
        if(properties.restricted !== undefined) {
          station.attr("restrictedStatus", getRestriction(properties.restricted.value));
          station.find("xmlns:Channel", namespace).forEach(function(channel) {
            channel.attr("restrictedStatus", getRestriction(properties.restricted.value));
          });
        }

        var stationCode = station.attr("code").value();

        logger.debug("Extracting station " + networkCode + "." + stationCode + " from document");

        // Namespace must be removed this way (known bug in libxmljs)
        // And then replaced out in the string representation
        station.namespace("");

        // Create a new XML document
        var stationXMLDocument = new libxmljs.Document("1.0", "UTF-8");

        // Add FDSNStationXML attributes
        var stationXMLRoot = stationXMLDocument.node("FDSNStationXML").attr({
          "xmlns": namespace,
          "schemaVersion": schemaVersion
        });

        // Add new properties to the root
        stationXMLRoot.node("Source", FDSN_SOURCE);
        stationXMLRoot.node("Sender", FDSN_SENDER);
        stationXMLRoot.node("Module", FDSN_MODULE);
        stationXMLRoot.node("Created", new Date().toISOString());

        stationXMLNetwork = stationXMLRoot.node("Network");

        // Add child nodes that are not "Station" or "text" (e.g. description)
        network.childNodes().forEach(function(x) {
          if(x.name() !== "Station" && x.name() !== "text") {
            stationXMLNetwork.node(x.name(), x.text());
          }
        });

        // Collect the attributes
        var attrs = new Object();
        network.attrs().forEach(function(x) {
          attrs[x.name()] = x.value();
        });

        // Set the attributes
        stationXMLNetwork.attr(attrs);

        // Add particular station
        stationXMLNetwork.addChild(station);

        // Create a hash of the network element
        var hash = SHA256(stationXMLNetwork.toString().replace(" xmlns=\"\"", ""));

        // Do not format the string when writing to disk
        // Otherwise we cannot calculate the hash because libxmljs refuses to work above
        var XMLString = stationXMLDocument.toString(false).replace(" xmlns=\"\"", "");

        XMLDocuments.push({
          "data": XMLString,
          "metadata": {
            "nChannels": station.find("xmlns:Channel", namespace).length,
            "network": {
              "code": networkCode,
              "start": networkStart,
              "end": networkEnd
            },
            "station": stationCode,
            "filepath": path.join(CONFIG.METADATA.PATH, networkCode, stationCode),
            "id": networkCode + "." + stationCode,
            "size": XMLString.length,
            "sha256": hash
          }
        });

      });

    });
  
  }
  
  return XMLDocuments;

}

module.exports = {
  splitStationXML,
  validateMetadata,
  parsePrototype,
  updateStationXML
}

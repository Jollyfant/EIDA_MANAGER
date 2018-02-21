const path = require("path");
const libxmljs = require("libxmljs");

const XSDSchema = require("./orfeus-xml");
const Console = require("./orfeus-logging");
const SHA256 = require("./orfeus-crypto.js");

const CONFIG = require("./config");

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
      throw("Invalid network code");
    }

    network.find("xmlns:Station", namespace).forEach(function(station) {

      var stationCode = station.attr("code").value();

      if(!STATION_REGEXP.test(stationCode)) {
        throw("Invalid station code");
      }

      var channels = station.find("xmlns:Channel", namespace);

      if(channels.length === 0) {
        throw("Channel information missing");
      }

      channels.forEach(function(channel) {

        var channelCode = channel.attr("code").value();

        var sampleRate = Number(channel.get("xmlns:SampleRate", namespace).text())

        if(isNaN(sampleRate) || sampleRate === 0) {
          throw("Invalid sample rate");
        }

        var response = channel.find("xmlns:Response", namespace);

        if(response.length === 0) {
          throw("Response element is missing");
        }

        if(response.length !== 1) {
          throw("Multiple response elements included");
        }

        var stages = response[0].find("xmlns:Stage", namespace);

        if(stages.length === 0) {
          throw("No response stages included in inventory");
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
          throw("Computed and reported stage gain is different");
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
    throw("FIR Stage input units invalid");
  }

  // Confirm FIR Stage output units as COUNTS
  if(FIRStage.get("xmlns:OutputUnits", namespace).get("xmlns:Name", namespace).text() !== "COUNTS") {
    throw("FIR Stage output units invalid");
  }

  var FIRSum = Sum(FIRStage.find("xmlns:NumeratorCoefficient", namespace).map(function(FIRCoefficient) {
    return Number(FIRCoefficient.text());
  }));

  // Symmetry specified: FIR coefficients are symmetrical (double the sum)
  if(FIRStage.get("xmlns:Symmetry", namespace).text() !== "NONE") {
    FIRSum = 2 * FIRSum;
  }

  // Check if the FIR coefficient sum is within tolerance
  if(Math.abs(1 - FIRSum) > FIR_TOLERANCE) {
    throw("Invalid FIR Coefficient Sum (" + Math.abs(1 - FIRSum).toFixed(4) + ")");
  }

}

function splitStationXML(files) {

  /* function splitStationXML
   * Validated and splits stationXML per station
   */

  const FDSN_SENDER = "ORFEUS";
  const FDSN_SOURCE = "ORFEUS Manager Upload";
  const FDSN_MODULE = "ORFEUS Manager " + CONFIG.__VERSION__;
  const FDSN_STATION_VERSION = "1.0";

  // Collection of documents to be written
  var XMLDocuments = new Array();

  for(var i = 0; i < files.length; i++) {

    // Convert to libxmljs object
    var XMLDocument = libxmljs.parseXml(files[i].data);

    // Validate the entire against the schema
    if(!XMLDocument.validate(XSDSchema)) {
      throw("Error validating FDSNStationXML");
    }

    validateMetadata(XMLDocument);

    // Get the namespace & schema version of document
    var namespace = XMLDocument.root().namespace().href();
    var schemaVersion = XMLDocument.root().attr("schemaVersion").value();

    // Confirm version
    if(schemaVersion !== FDSN_STATION_VERSION) {
      throw("Invalid FDSNStationXML version");
    }

    // Split entries by Network / Station
    XMLDocument.find("xmlns:Network", namespace).forEach(function(network) {

      var networkCode = network.attr("code").value();

      network.find("xmlns:Station", namespace).forEach(function(station) {

        var stationCode = station.attr("code").value();

        Console.debug("Extracting station " + networkCode + "." + stationCode + " from document");

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

        // Validate the entire against the schema
        var XMLString = stationXMLDocument.toString().replace(" xmlns=\"\"", "");

        // Validate the extracted document against the schema (only during DEBUG)
        if(CONFIG.__DEBUG__ && !libxmljs.parseXml(XMLString).validate(XSDSchema)) {
          throw("Extracted document does not validate.");
        }

        XMLDocuments.push({
          "data": XMLString,
          "metadata": {
            "network": networkCode,
            "station": stationCode,
            "filepath": path.join("files", networkCode, stationCode),
            "id": networkCode + "." + stationCode,
            "size": XMLString.length,
            "sha256": SHA256(XMLString)
          }
        });

      });

    });
  
  }

  return XMLDocuments;

}

function Sum(array) {

  /* function Sum
   * returns the sum of an array
   */

  return array.reduce(function(a, b) {
    return a + b;
  }, 0);

}

module.exports = splitStationXML;

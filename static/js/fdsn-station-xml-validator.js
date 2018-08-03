/* EIDA Manager - module fdsn-station-xml-validator.js
 *
 * JavaScript module for client-side validation ofStationXML
 *
 * Copyright ORFEUS Data Center, 2018
 * 
 * Authors:
 * Vincent van der Heiden, 2018
 * Mathijs Koymans, 2018
 *
 */

function validateFiles(files) {

  function convertISO(date) {
  
    /* function convertISO
     * Converts a ISO string missing "Z" to a proper one
     */
  
    if(date === null) {
      return null;
    }
  
    // Isodate
    if(!date.endsWith("Z")) {
      date += "Z";
    }
  
    return new Date(date).toISOString();
  
  }

  /* function validateFiles
   * validates uploaded StationXML files
   * throws an exception on formatting error
   */

  const FDSN_STATION_XML_HEADER = "FDSNStationXML";
  const NETWORK_REGEXP = new RegExp(/^[a-z0-9]{1,2}$/i);
  const STATION_REGEXP = new RegExp(/^[a-z0-9]{1,5}$/i);

  var stagedStations = new Array();

  // Map of stations included by FDSN webservice
  var stationsMap = _stationJson.map(x => x.station);

  // Validate each file
  files.forEach(function(file) {

    // Parse the XML using the native DOMParser
    var XML = new DOMParser().parseFromString(file.data, "text/xml");

    // Confirm that XML owns the FDSNStationXML namespace
    if(XML.documentElement.nodeName !== FDSN_STATION_XML_HEADER) {
      throw("Invalid FDSN Station XML");
    }

    // Go over all networks and collect station names
    Array.from(XML.getElementsByTagName("Network")).forEach(function(network) {

      // Extract network core properties
      var networkCode = network.getAttribute("code");
      var networkStart = convertISO(network.getAttribute("startDate"));
      var networkEnd = convertISO(network.getAttribute("endDate"));

      // Confirm network regex & user must own network (allow administrators)
      if(!NETWORK_REGEXP.test(networkCode) || USER_NETWORK.code !== networkCode) {
        throw("Invalid network code: " + networkCode);
      }

      if(USER_NETWORK.start !== networkStart) {
        throw("Invalid network start time: " + networkStart);
      }

      if(USER_NETWORK.end !== networkEnd) {
        throw("Invalid network end time: " + networkEnd);
      }

      Array.from(network.getElementsByTagName("Station")).forEach(function(station) {

        var stationCode = station.getAttribute("code");

        if(!STATION_REGEXP.test(stationCode)) {
          throw("Invalid station code: " + stationCode);
        }

        // Detailed sanization check on station metadata
        try {
          validateStationMetadata(station);
        } catch(exception) {
          throw(exception + " for station " + networkCode + "." + stationCode + "."); 
        }

        stagedStations.push({
          "network": networkCode,
          "station": stationCode,
          "new": (stationsMap.indexOf(stationCode) === -1)
        });

      });

    });

  });

  return stagedStations;

}

function validateStationMetadata(station) {

  /* function validateMetadata
   * Validates common StationXML issues for a single station
   */

  const GAIN_TOLERNACE_PERCENT = 0.001;

  // Confirm station spatial coordinates
  var stationLatitude = Number(station.getElementsByTagName("Latitude").item(0).innerHTML);
  var stationLongitude = Number(station.getElementsByTagName("Longitude").item(0).innerHTML);

  // Make sure the station is on Earth
  if(stationLatitude < -90 || stationLatitude > 90) {
    throw("Station latitude is incorrect");
  }
  if(stationLongitude < -180 || stationLongitude > 180) {
    throw("Station longitude is incorrect");
  }

  var channels = Array.from(station.getElementsByTagName("Channel"));

  if(channels.length === 0) {
    throw("Channel information is missing");
  }

  // Go over each channel for the station
  channels.forEach(function(channel) {

    var channelCode = channel.getAttribute("code");

    if(channelCode === "LOG") {
      return;
    }

    // Confirm channel spatial coordinates
    var channelLatitude = Number(channel.getElementsByTagName("Latitude").item(0).innerHTML);
    var channelLongitude = Number(channel.getElementsByTagName("Longitude").item(0).innerHTML);

    if(channelLatitude !== stationLatitude) {
      throw("Channel latitude is incorrect");
    }

    if(channelLongitude !== stationLongitude) {
      throw("Channel longitude is incorrect");
    }

    var sampleRate = Number(channel.getElementsByTagName("SampleRate").item(0).innerHTML);

    if(isNaN(sampleRate) || sampleRate === 0) {
      throw("Invalid sample rate");
    }

    // Get the response element
    var response = channel.getElementsByTagName("Response");

    if(response.length === 0) {
      throw("Response element is missing from inventory");
    }

    if(response.length > 1) {
      throw("Multiple response elements included");
    }

    var stages = Array.from(response.item(0).getElementsByTagName("Stage"));

    if(stages.length === 0) {
      throw("Response stages missing from inventory");
    }

    var perStageGain = 1;

    // Go over all stages
    stages.forEach(function(stage) {

      // Get the stage gain
      stageGain = Number(stage.getElementsByTagName("StageGain").item(0).getElementsByTagName("Value").item(0).innerHTML);

      if(stageGain === 0) {
        throw("Invalid stage gain of 0");
      }

      perStageGain = perStageGain * stageGain;

      // Confirm FIR stage properties
      Array.from(stage.getElementsByTagName("FIR")).forEach(validateFIRStage);

    });

    // Total channel sensitivity
    var instrumentSensitivity = Number(response.item(0).getElementsByTagName("InstrumentSensitivity").item(0).getElementsByTagName("Value").item(0).innerHTML);

    if(1 - (Math.max(instrumentSensitivity, perStageGain) / Math.min(instrumentSensitivity, perStageGain)) > GAIN_TOLERNACE_PERCENT) {
      throw("Computed and reported stage gain is different");
    }

  });

}

function validateFIRStage(FIRStage) {

  /* function validateFIRStage
   * Validates the properties of a FIR response stage
   */

  const FIR_TOLERANCE = 0.02;

  // Confirm FIR Stage input units as COUNTS
  if(FIRStage.getElementsByTagName("InputUnits").item(0).getElementsByTagName("Name").item(0).innerHTML !== "COUNTS") {
    throw("FIR Stage input units invalid");
  }

  // Confirm FIR Stage output units as COUNTS
  if(FIRStage.getElementsByTagName("OutputUnits").item(0).getElementsByTagName("Name").item(0).innerHTML !== "COUNTS") {
    throw("FIR Stage output units invalid");
  }

  var FIRSum = Sum(Array.from(FIRStage.getElementsByTagName("NumeratorCoefficient")).map(function(FIRCoefficient) {
    return Number(FIRCoefficient.innerHTML);
  }));

  // Symmetry specified: FIR coefficients are symmetrical (double the sum)
  if(FIRStage.getElementsByTagName("Symmetry").item(0).innerHTML !== "NONE") {
    FIRSum = 2 * FIRSum;
  }

  // Check if the FIR coefficient sum is within tolerance
  if(Math.abs(1 - FIRSum) > FIR_TOLERANCE) {
    throw("Invalid FIR Coefficient Sum (" + Math.abs(1 - FIRSum).toFixed(4) + ")");
  }

}

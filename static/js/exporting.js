function downloadAsKML() {

  /*
   * Function downloadAsKML
   * Opens download for station metata in KML format
   */

  function generateKMLPlacemarks() {

    /*
     * Function downloadAsKML::generateKMLPlacemarks
     * Generates KML string from station JSON for exporting
     */

    return _stationJson.map(function(station) {
      return [
        "<Placemark>",
        "<Point>",
        "<coordinates>" + station.position.lng + "," + station.position.lat + "</coordinates>",
        "</Point>",
        "<Network>" + station.network + "</Network>",
        "<description>" + station.description + "</description>",
        "<Station>" + station.station + "</Station>",
        "</Placemark>"
      ].join("\n");
    }).join("\n");

  }

  const XML_VERSION = "1.0";
  const XML_ENCODING = "UTF-8";
  const KML_VERSION = "2.2";
  const MIME_TYPE = "data:text/xml;charset=utf-8";

  // Encode the payload for downloading
  var payload = encodeURIComponent([
    "<?xml version='" + XML_VERSION + "' encoding='" + XML_ENCODING + "'?>",
    "<kml xmlns='http://earth.google.com/kml/" + KML_VERSION + "'>",
    generateKMLPlacemarks(),
    "</kml>"
  ].join("\n"));

  downloadURIComponent("stations.kml", MIME_TYPE + "," + payload);

}

function downloadURIComponent(name, string) {

  /*
   * Function downloadURIComponent
   * Creates a temporary link component used for downloading
   */

  var downloadAnchorNode = document.createElement("a");

  // Set some attribtues
  downloadAnchorNode.setAttribute("href", string);
  downloadAnchorNode.setAttribute("download", name);

  // Add and trigger click event
  document.body.appendChild(downloadAnchorNode);
  downloadAnchorNode.click();

  // Clean up
  document.body.removeChild(downloadAnchorNode);

}

function downloadAsCSV() {

  /*
   * Function downloadAsCSV
   * Generates JSON representation of station table
   */

  const MIME_TYPE = "data:text/csv;charset=utf-8";
  const CSV_HEADER = ["Network", "Station", "Description", "Latitude", "Longitude", "Elevation", "Start"].join(",");

  var payload = _stationJson.map(x => [x.network, x.station, x.description, x.position.lat, x.position.lng, x.elevation, x.start].join(","));

  // Add the header
  payload.unshift(CSV_HEADER);

  // Add new lines and encode the data
  var payload = encodeURIComponent(payload.join("\n"));

  downloadURIComponent("stations.csv", MIME_TYPE + "," + payload);

}

function downloadAsJSON() {

  /*
   * Function downloadAsJSON
   * Generates JSON representation of station table
   */

  const MIME_TYPE = "data:application/json;charset=utf-8";

  var payload = encodeURIComponent(JSON.stringify(_stationJson));

  downloadURIComponent("stations.json", MIME_TYPE + "," + payload);

}

function downloadAsGeoJSON() {

  /*
   * Function downloadAsGeoJSON
   * Exports station information as GeoJSON
   */

  function getFeature(station) {

    /*
     * Function downloadAsGeoJSON::getFeature
     * Returns GeoJSON representation of station as GeoJSON Feature
     */

    return {
      "type": "Feature",
      "geometry": {
        "type": "Point",
        "coordinates": [station.position.lng, station.position.lat]
      },
      "properties": {
        "network": station.network,
        "description": station.description,
        "station": station.station,
        "elevation": station.elevation,
        "start": station.start,
        "end": station.end
      }
    }

  }

  const MIME_TYPE = "data:application/vnd.geo+json;charset=utf-8";

  // Encode the GeoJSON
  var payload = JSON.stringify({
    "type": "FeatureCollection",
    "features": _stationJson.map(getFeature)
  });

  // Download file
  downloadURIComponent("stations.geojson", MIME_TYPE + "," + payload);

}

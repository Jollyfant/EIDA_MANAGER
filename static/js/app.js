const __DEBUG__ = true;
const STATION_MARKER_GREEN = "/images/station-green.png";
const STATION_MARKER_ORANGE = "/images/station-orange.png";
const STATION_MARKER_GREY = "/images/station-grey.png";
const STATION_MARKER_RED = "/images/station-red.png";
const NODE_MARKER = "/images/node.png";
const SOCKET_URL = "https://orfeus-eu.org/"

var __TABLE_JSON__;
var chartPointers;
var _stationJson;
var _hashMap;
var _channelJson;
var ACTIVE_PAGE_INDEX = 0;
var map, infowindow;

function getCountryFlag(archive) {

  /* function getCountryFlag
   * Returns the country flag for an EIDA node
   */

  // Unicode descriptions
  const FLAG_NETHERLANDS = "&#x1F1F3;&#x1F1F1;";
  const FLAG_GERMANY = "&#x1F1E9;&#x1F1EA;";
  const FLAG_SWITZERLAND = "&#x1F1E8;&#x1F1ED";
  const FLAG_ITALY = "&#x1F1EE;&#x1F1F9;";
  const FLAG_ROMANIA = "&#x1F1F7;&#x1F1F4;";
  const FLAG_FRANCE = "&#x1F1EB;&#x1F1F7;";
  const FLAG_GREECE = "&#x1F1EC;&#x1F1F7;";
  const FLAG_TURKEY = "&#x1F1F9;&#x1F1F7;";

  if(archive === "ODC") {
    return FLAG_NETHERLANDS;
  } else if(archive === "GFZ" || archive === "LMU" || archive === "BGR") {
    return FLAG_GERMANY;
  } else if(archive === "SED") {
    return FLAG_SWITZERLAND;
  } else if(archive === "INGV") {
    return FLAG_ITALY;
  } else if(archive === "NIEP") {
    return FLAG_ROMANIA;
  } else if(archive === "RESIF" || archive === "IPGP") {
    return FLAG_FRANCE;
  } else if(archive === "NOA") {
    return FLAG_GREECE;
  } else if(archive === "KOERI") {
    return FLAG_TURKEY;
  }

}

function AddMap() {

  /* function AddMap
   * Initializes code for Google Maps application
   */

  function generateNodeInfoWindow(node) {
  
    /* AddMap::generateNodeInfoWindow
     * Generates HTML for the EIDA node info window
     */

    return [
      "<h5>" + getCountryFlag(node.id) + " EIDA Node " + node.id + "</h5>",
      "<hr>",
      node.title
    ].join("");
  
  }

  var start = Date.now();

  infowindow = new google.maps.InfoWindow();
  map = new google.maps.Map(Element("map"), {"minZoom": 2, "disableDefaultUI": true});

  // Listener on map to close the info window
  map.addListener("click", function() {
    infowindow.close();
  });

  const NODES = [{
    "name": "ORFEUS Data Center",
    "id": "ODC",
    "position": {
      "lat": 52.10165,
      "lng": 5.1783
    }
  }];

  // Add the EIDA nodes
  NODES.forEach(function(node) {

    var marker = new google.maps.Marker({
      "map": map,
      "position": node.position,
      "id": node.id,
      "title": "ORFEUS Data Center",
      "icon": NODE_MARKER,
      "zIndex": 100
    });

    // Add listener to the EIDA nodes
    marker.addListener("click", function() {
      infowindow.close();
      infowindow.setContent(generateNodeInfoWindow(marker));
      infowindow.open(map, this);
    });

  });

  console.debug("Map has been initialized in " + (Date.now() - start) + " ms.");

}

function newMessageNotification() {

  /* function newMessageNotification
   * Polls the api for new notifications
   */

  function generateNotificationMessage(count) {

    /* function newMessageNotification::generateNotificationMessage
     * Generates HTML string for new messages
     */

    switch(count) {
      case 0:
        return "No new messages";
      case 1:
        return "1 new messages";
      default:
        return count + " new messages";
    }

  }

  const NOTIFICATION_POLL_MS = 60000;

  var start = Date.now();

  // Make a request to get the number of new messages
  $.ajax({
    "cache": false,
    "url": "/api/messages?new",
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      console.debug("Retrieved " + json.count + " new message(s) from server in " + (Date.now() - start) + " ms.");

      Element("number-messages").innerHTML = generateNotificationMessage(json.count);

    }

  });

  // Set next refresh for notifications
  setTimeout(newMessageNotification, NOTIFICATION_POLL_MS);

}

function getStationLatencies(query) {

  const LATENCY_POLL_MS = 60000;

  var start = Date.now();

  $.ajax({
    "url": "/api/latency" + query, 
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      console.debug("Retrieved " + json.length + " latencies in " + (Date.now() - start) + " ms.");

      const LATENCY_TABLE_HEADER = [
        "Channel",
        "Last Record",
        "Latency (s)"
      ];

      var latencies = generateLatencyInformationContent(json);

      new Table({
        "id": "channel-information-latency",
        "search": false,
        "header": LATENCY_TABLE_HEADER,
        "body": latencies
      });

    }

  });

  setTimeout(getStationLatencies.bind(this, query), LATENCY_POLL_MS);

}

function getMessageDetails() {

  /* function getMessageDetails
   * Collects specific message from API
   */

  // No query
  if(window.location.search === "") {
    return;
  }

  $.ajax({
    "url": "/api/messages/details" + window.location.search,
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {
      document.getElementById("message-detail").innerHTML = generateMessageDetails(json);
    }

  });

}

function generateMessageAlert(type, message) {

  /* function generateMessageAlert
   * Generates HTML for an alert message with icon
   */

  function getAlertIcon(type) {
  
    /* function generateMessageAlert::getAlertIcon
     * Returns an icon related to the alert type
     */

    switch(type) {
      case "danger":
        return Icon("remove", "danger");
      case "warning":
        return Icon("question", "warning");
      case "success":
        return Icon("check", "success");
    }
  
  }

  return [
    "<div class='alert alert-" + type + "'>",
    getAlertIcon(type),
    message,
    "</div>"
  ].join("\n");

}

function messageRoute() {

  const API_URL = "/api/messages";

  const MESSAGE_TABLE_HEADER_SENT = [
    "Subject",
    "Recipient",
    "Message Received"
  ];

  const MESSAGE_TABLE_HEADER = [
    "Subject",
    "Sender",
    "Message Received"
  ];

  $.ajax({
    "url": API_URL, 
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      console.debug("Retrieved " + json.length +  " message(s) from server.");

      new Table({
        "id": "message-content-sent",
        "search": true,
        "header": MESSAGE_TABLE_HEADER_SENT,
        "body": generateMessageTableContentSent(json.filter(function(x) {
          return x.author;
        }))
      });

      new Table({
        "id": "message-content",
        "search": true,
        "header": MESSAGE_TABLE_HEADER,
        "body": generateMessageTableContent(json.filter(function(x) {
          return !x.author;
        }))
      });

    }

  });

}

function initApplication() {

  /* function initApplication
   * Initializes the application
   */

  var uri = new URL(window.location.href);

  console.debug("Initializing application at " + uri.href + ".");

  // Generate the breadcrumbs from the URI
  document.getElementById("breadcrumb-container").innerHTML = generateBreadcrumb(uri.pathname); 

  // Get new notifications
  newMessageNotification();

  // Message details
  if(uri.pathname === "/home/messages/details") {
    return getMessageDetails();
  }

  if(uri.pathname === "/home/messages/new") {

    const S_MESSAGE_SENT = "Private message has been succesfully sent.";
    const E_MESSAGE_RECIPIENT_NOT_FOUND = "Recipient could not be found.";
    const E_MESSAGE_SERVER_ERROR = "Private message could not be sent. Please try again later.";
    const E_MESSAGE_SELF = "Cannot send private message to yourself.";

    document.getElementById("final-crumb").innerHTML = "Create Message";

    var alertBox = Element("message-information");

    switch(uri.search) {
      case "?self":
        alertBox.innerHTML = generateMessageAlert("warning", E_MESSAGE_SELF);
        break;
      case "?unknown":
        alertBox.innerHTML = generateMessageAlert("warning", E_MESSAGE_RECIPIENT_NOT_FOUND);
        break;
      case "?success":
        alertBox.innerHTML = generateMessageAlert("success", S_MESSAGE_SENT);
        break
      case "?failure":
        alertBox.innerHTML = generateMessageAlert("danger", E_MESSAGE_SERVER_ERROR);
        break;
    }
 
  }

  // Message overview is requested
  if(uri.pathname === "/home/messages") {
    messageRoute();
  }

  if(uri.pathname === "/home/station") {

    AddMap();

    // Hoist an empty socket
    __SOCKET__ = null

    var qs = parseQuery(window.location.search);

    // Change event to toggle WS connection
    Element("connect-seedlink").addEventListener("change", function() {

      // Not connected and socket is empty
      if(!Element("connect-seedlink").checked && __SOCKET__) {
        __SOCKET__.disconnect();
        return;
      } else {
        __SOCKET__ = io(SOCKET_URL, {"path": "/socket.io"});
      }

      __SOCKET__.on("disconnect", function() {
        console.debug("Disconnected socket from " + SOCKET_URL);
        __SOCKET__ = null;
      });

      __SOCKET__.on("connect", function() {
        __SOCKET__.emit("subscribe", qs.network + "." + qs.station); 
        console.debug("Connected to socket at " + SOCKET_URL);
      });

      __SOCKET__.on("record", function(data) {

        if(!chartPointers.hasOwnProperty(data.id)) {
          chartPointers[data.id] = new SeedlinkChannel(data);
        } else {
          chartPointers[data.id].Update(data);
        }

      });

    });
  
    const MAP_DEFAULT_ZOOM_LEVEL = 12;

    $.ajax({
      "url": "/api/channels" + uri.search,
      "type": "GET",
      "dataType": "JSON",
      "success": function(json) {

        _channelJson = json;
        getStationLatencies(uri.search);

        document.getElementById("channel-information").innerHTML = generateAccordion(_channelJson);

        document.getElementById("hide-channels").addEventListener("change", function() {
          document.getElementById("channel-information").innerHTML = generateAccordion(_channelJson);
        });

        var nOpen = json.filter(isStationActive).length;

        var station = json[0];

        var marker = new google.maps.Marker({
          "map": map,
          "icon": isStationActive(station) ? STATION_MARKER_GREEN : STATION_MARKER_ORANGE,
          "title": [station.network, station.station].join("."),
          "position": station.position
        }); 

        updateCrumbTitle(marker.title);

        document.getElementById("channel-information-header").innerHTML = Icon("signal") + " " + marker.title;
        document.getElementById("map-information").innerHTML = "Map showing station <b>" + marker.title + "</b> with <b>" + nOpen + "</b> open channels.";

        // Event listener for clicks
        marker.addListener("click", function() {
          infowindow.close();
          infowindow.setContent("Station " + marker.title)
          infowindow.open(map, this);
        });

        map.setCenter(station.position);
        map.setZoom(MAP_DEFAULT_ZOOM_LEVEL);

      }
    });

  }

  // Initialize map on the main home page
  if(uri.pathname === "/home") {

    // Send notification
    const S_METADATA_SUCCESS = "The metadata has been succesfully received";
    const S_SEEDLINK_SERVER_SUCCESS = "The Seedlink server has been succesfully added";
    const E_METADATA_ERROR = "There was an error receiving the metadata";
    const E_INTERNAL_SERVER_ERROR = "The server experienced an internal error";
    const E_SEEDLINK_SERVER_EXISTS = "The submitted Seedlink server already exists";
    const E_SEEDLINK_HOST_INVALID = "The Seedlink host is invalid";
    const E_SEEDLINK_PORT_INVALID = "The Seedlink port is invalid";
    const E_UNKNOWN_ERROR = "The server experienced an unknown error";

    if(uri.search && uri.search !== "?welcome") {
      switch(uri.search.substring(1)) {
        case "S_METADATA_SUCCESS":
          Element("modal-content").innerHTML = generateMessageAlert("success", S_METADATA_SUCCESS); break;
        case "S_SEEDLINK_SERVER_SUCCESS":
          Element("modal-content").innerHTML = generateMessageAlert("success", S_SEEDLINK_SERVER_SUCCESS); break;
        case "E_METADATA_ERROR":
          Element("modal-content").innerHTML = generateMessageAlert("danger", E_METADATA_ERROR); break;
        case "E_INTERNAL_SERVER_ERROR":
          Element("modal-content").innerHTML = generateMessageAlert("danger", E_INTERNAL_SERVER_ERROR); break;
        case "E_SEEDLINK_SERVER_EXISTS":
          Element("modal-content").innerHTML = generateMessageAlert("danger", E_SEEDLINK_SERVER_EXISTS); break;
        case "E_SEEDLINK_HOST_INVALID":
          Element("modal-content").innerHTML = generateMessageAlert("danger", E_SEEDLINK_HOST_INVALID); break;
        case "E_SEEDLINK_PORT_INVALID":
          Element("modal-content").innerHTML = generateMessageAlert("danger", E_SEEDLINK_PORT_INVALID); break;
        default:
          Element("modal-content").innerHTML = generateMessageAlert("danger", E_UNKNOWN_ERROR); break;
      }
      $("#modal-alert").modal();
    }

    // Add map
    AddMap();

    // Add upload button for metadata
    AddMetadataUpload();

    var markers = new Array();
    var start = Date.now();

    function queryStaged() {
      $.ajax({
        "cache": false,
        "url": "/api/staged",
        "type": "GET",
        "dataType": "JSON",
        "success": function(json) {

          createStagedMetadataTable(json);

        }
      });
    }

    queryStaged();
    setInterval(queryStaged, 10000);

    // Add the stations to the map
    $.ajax({
      "cache": false,
      "url": "/api/stations",
      "type": "GET",
      "dataType": "JSON",
      "success": function(json) {

        console.debug("Retrieved " + json.length + " stations from server in " + (Date.now() - start) + "ms.");

        _stationJson = json;

        // For each entry create a station marker
        json.forEach(function(station) {
          var marker = new google.maps.Marker({
            "map": map,
            "icon": getOperationalStationMarker(station),
            "title": [station.network, station.station].join("."), 
            "description": station.description,
            "station": station.station,
            "start": station.start,
            "end": station.end,
            "network": station.network,
            "position": station.position,
          });

          // Event listener for clicks
          marker.addListener("click", function() {
            infowindow.close();
            infowindow.setContent(GoogleMapsInfoWindowContent(this))
            infowindow.open(map, this);
          });

          // Make sure to keep a reference
          markers.push(marker);

        });

        // Fit map bounds around all markers
        fitMapBounds(markers);
        changeMapLegend(markers);

        Element("map-information").innerHTML = MapInformationText(json.length);
        Element("map-display").addEventListener("change", changeMapLegend.bind(this, markers));

        // Proceed with the table
        GenerateTable(json);

      }

    });

  }

}

function createStagedMetadataTable(json) {

  function getStatus(status) {

    /* function getStatus
     * Returns string representation of metadata status
     */

    const METADATA_STATUS_REJECTED = -1;
    const METADATA_STATUS_UNCHANGED = 0;
    const METADATA_STATUS_PENDING = 1;
    const METADATA_STATUS_VALIDATED = 2;
    const METADATA_STATUS_CONVERTED = 3;
    const METADATA_STATUS_APPROVED = 4;

    switch(status) {
      case METADATA_STATUS_REJECTED:
        return "<span class='text-danger'>" + Icon("remove") + " Rejected </span>"
      case METADATA_STATUS_PENDING:
        return "<span class='text-muted'>" + Icon("clock-o") + " Pending </span>"
      case METADATA_STATUS_VALIDATED:
        return "<span class='text-warning'>" + Icon("flag") + " Validated </span>"
      case METADATA_STATUS_CONVERTED:
        return "<span class='text-info'>" + Icon("cogs") + " Converted </span>"
      case METADATA_STATUS_APPROVED:
        return "<span class='text-success'>" + Icon("check") + " Approved </span>"
      default:
        return "<span class='text-muted'>" + Icon("question") + " Unknown </span>"
    }

  }

  const HTML_TABLE_ID = "table-staged-metadata";

  json.sort(function(a, b) {
    return Date.parse(b.created) - Date.parse(a.created);
  });

  var stagedTable = json.map(function(file) {
    return [
      file._id.network, 
      file._id.station + (file.new ? "&nbsp; <span class='fa fa-star text-warning'></span>" : ""),
      file.nChannels,
      file.size,
      file.created,
      file.modified || file.created,
      "<b>" + getStatus(file.status) + "</b>"
    ];
  });

  Element("table-staged-legend").style.display = 'inline-block';

  const STAGED_METADATA_TABLE_HEADER = [
    "Network",
    "Station",
    "Number of Channels",
    "Size",
    "Submitted",
    "Modified",
    "Current Status"
  ];

  new Table({
    "id": HTML_TABLE_ID,
    "header": STAGED_METADATA_TABLE_HEADER,
    "body": stagedTable,
    "search": true
  });

}


function changeMapLegend(markers) {

  /* function changeMapLegend
   * Changes the HTML of the map legend
   */

  function formatMapLegend(type, legendObject) {
  
    /* function changeMapLegend::formatMapLegend
     * Formats the submitted map legend object
     */

    function formatMapLegendType(type) {

      /* function changeMapLegend::formatMapLegend::formatMapLegendType
       * Returns a title for the legend type
       */

      switch(type) {
        case "latency":
          return "Status of Station Data Latencies";
        case "deployment":
          return "Deployment Type of Stations";
        case "operational":
          return "Operational Status of Stations";
      }

    }

    return "<h6>" + formatMapLegendType(type) + "</h6>" + legendObject.map(function(x) {
      return "<img style='vertical-align: top;' src='" + x.icon + "'><b> " + x.description + "</b>";
    }).join("&nbsp; &nbsp;");
  
  }

  // Legend labels
  const MAP_LEGEND_LATENCY = [
    {"icon": STATION_MARKER_GREEN, "description": "Low"},
    {"icon": STATION_MARKER_ORANGE, "description": "Medium"},
    {"icon": STATION_MARKER_RED, "description": "High"},
    {"icon": STATION_MARKER_GREY, "description": "Unknown"},
  ];

  const MAP_LEGEND_OPERATIONAL = [
    {"icon": STATION_MARKER_GREEN, "description": "Operational"},
    {"icon": STATION_MARKER_RED, "description": "Closed"},
  ];

  const MAP_LEGEND_DEPLOYMENT = [
    {"icon": STATION_MARKER_GREEN, "description": "Permanent"},
    {"icon": STATION_MARKER_RED, "description": "Temporary"},
  ];

  const mapLegend = Element("map-legend");

  switch(Element("map-display").value) {

    case "latency":
      markers.forEach(function(marker) {
        marker.setIcon(getLatencyStatusMarker(marker));
      });
      mapLegend.innerHTML = formatMapLegend("latency", MAP_LEGEND_LATENCY);
      break;

    case "operational":
      markers.forEach(function(marker) {
        marker.setIcon(getOperationalStationMarker(marker));
      });
      mapLegend.innerHTML = formatMapLegend("operational", MAP_LEGEND_OPERATIONAL);
      break;

    case "deployment":
      markers.forEach(function(marker) {
        marker.setIcon(getDeploymentStationMarker(marker));
      });
      mapLegend.innerHTML = formatMapLegend("deployment", MAP_LEGEND_DEPLOYMENT);
      break;
  }

}

function AddSeedlink() {

  const SEEDLINK_TABLE_HEADER = [
    "",
    "Address",
    "Port",
    "Institution",
    "Version",
    "Stations",
  ];

  $.ajax({
    "url": "/api/seedlink",
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      var tableContent = json.map(function(x) {

        var icon = " &nbsp; " + (x.connected ? Icon("check", "success") : Icon("remove", "danger"));
        var host = x.host + " <small><span class='text-muted'>(" + x.ip + ")</span></small>"
        var version = x.version || "";
        version = version.split("::")[0];
        var identifier = x.identifier || "";
 
        if(x.stations && x.stations.length > 0) {

          if(Array.isArray(x.stations)) {
            s = x.stations.map(function(x) {
              return x.network + "." + x.station;
            }).map(function(x) {
              if(_hashMap.hasOwnProperty(x)) {
                return "<span class='text-success'><b>" + x + "</b></span>";
              } else {
                return "<span class='text-muted'><b>" + x + "</b></span>";
              }
            }).join(", ");
          } else {
            s = "<small>" + x.stations + "</small>";
          }

          return [icon, host, x.port, identifier, version, s];

        }

        if(x.stations && x.stations.length === 0) {
          return [icon, host, x.port, identifier, version, "<small> No stations available for network " + USER_NETWORK + "</small>"];
        } else {
          return [icon, host, x.port, identifier, version, "<small>Seedlink Server is unreachable</small>"];
        }

      });

      new Table({
        "id": "seedlink-connection-table",
        "header": SEEDLINK_TABLE_HEADER,
        "body": tableContent,
        "search": false
      });

    }

  });

}

function getDeploymentStationMarker(marker) {

  /* function getDeploymentStationMarker
   * Returns marker for permanent (GREEN) & temporary (RED) station
   */

  return isStationPermanent(marker) ? STATION_MARKER_GREEN : STATION_MARKER_RED; 

}

function getOperationalStationMarker(marker) {

  /* function getOperationalStationMarker
   * Returns marker for open (GREEN) & closed (RED) station
   */

  return isStationActive(marker) ? STATION_MARKER_GREEN : STATION_MARKER_RED;

}


function Element(id) {

  /* function Element
   * Returns the DOM element with particular ID
   */

  return document.getElementById(id);

}

function fitMapBounds(markers) {

  /* function fitMapBounds
   * Zooms to fit all markers in bounds
   */

  var bounds = new google.maps.LatLngBounds();

  markers.forEach(function(marker) {
    bounds.extend(marker.getPosition());
  });

  map.fitBounds(bounds);

}

function generateMessageTableContentSent(json) {

  /* generateMessageTableContentSent
   */

  return json.map(function(x) {
    return [
      (x.read ? "&nbsp; <span class='fa fa-envelope-open text-danger'></span> " : "&nbsp; <span class='fa fa-envelope text-success'></span><b> ") + "&nbsp; <a href='/home/messages/details?id=" + x._id + "'>" + x.subject + "</b></a>",
      formatMessageSender(x.recipient),
      x.created
    ];
  });

}

function generateMessageTableContent(json) {

  return json.map(function(x) {
    return [
      (x.read ? "&nbsp; <span class='fa fa-envelope-open text-danger'></span> " : "&nbsp; <span class='fa fa-envelope text-success'></span><b> ") + "&nbsp; <a href='/home/messages/details?id=" + x._id + "'>" + x.subject + "</b></a>",
      formatMessageSender(x.sender),
      x.created
    ];
  });

}

function updateCrumbTitle(text) {
  Element("final-crumb").innerHTML= text;
}

function generateMessageDetails(message) {

  const E_MESSAGE_NOT_FOUND = "Message not found";

  // No message was returned
  if(message === null) {
    return generateMessageAlert("danger", E_MESSAGE_NOT_FOUND);
  }

  console.debug("Retrieved message with id " + message._id + " from server.");
  updateCrumbTitle("Subject: " + message.subject);

  return [
    "<div class='card'>",
      "<div class='card-header'>",
        "<small style='float: right;'>Sent at " + Icon("clock-o") + " " + message.created + "</small>",
        "<h5><b><span class='fa fa-envelope-o'></span> " + message.subject + "</b></h5>",
      "</div>",
      "<div class='card-block'>",
      message.content,
      "<hr>",
      "<button class='btn btn-danger btn-sm' style='float: right;' onClick='deleteMessage()'><span class='fa fa-trash'></span> Delete Message</button>",
      (message.author ? "Recipient: " +  formatMessageSender(message.contact) : "Sender: " + formatMessageSender(message.contact)),
      "</div>",
    "</div>",
  ].join("\n");

}

function deleteAllMessages(type) {

  // Confirm deletion
  if(!confirm("Are you sure you want to delete all messages?")) {
    return;
  }

  var search;

  if(type === "inbox") {
    search = "deleteall";
  } else if(type === "sent") {
    search = "deletesent";
  } else {
    throw("Could not delete all messages");
  }

  // Instead of "read" we pass "delete" to the API with the same message identifier
  $.ajax({
    "url": "/api/messages?" + search,
    "type": "GET",
    "dataType": "JSON",
    "success": function() {
      window.location.reload();
    }
  });

}

function deleteMessage() {

  /* function deleteMessage
   * Deletes message with a given identifier
   */

  const E_SERVER_ERROR_MESSAGE_DELETED = "Could not delete message";
  const S_MESSAGE_DELETED = "Message has been deleted";

  // Confirm message deletion
  if(!confirm("Are you sure you want to delete this message?")) {
    return;
  }

  // Instead of "read" we pass "delete" to the API with the same message identifier
  $.ajax({
    "url": "/api/messages/details" + window.location.search,
    "type": "DELETE",
    "dataType": "JSON",
    "success": function(json) {

      if(json === null) {
        Element("message-detail").innerHTML = generateMessageAlert("danger", E_SERVER_ERROR_MESSAGE_DELETED);
      } else {
        Element("message-detail").innerHTML = generateMessageAlert("success", S_MESSAGE_DELETED);
      }

    }

  });

}

function formatMessageSender(sender) {

  /* function formatMessageSender
   * Returns specific formatting for particular senders (e.g. administrator)
   */

  // Indicate user is an administrator
  if(sender.role === "admin") {
    return sender.username + " (<span class='text-danger'><b>O</span>RFEUS Administrator</b>)";
  }
 
  return sender.username;

}

function Icon(icon, color) {

  /* function Icon
   * Returns font-awesome icon
   */

  return "<span class='fa fa-" + icon + " text-" + color + "'></span>";

}

function GoogleMapsInfoWindowContent(marker) {
  return "<h5>" + Icon("cog", "danger") + " " + marker.title + "</h5><hr><p>" + marker.description + "<p><a href='/home/station?network=" + marker.network + "&station=" + marker.station + "'>View instrument details</a>"; 
}

function MapInformationText(nStations) {
  return "Map showing <b>" + nStations + "</b> stations.";
}

function getNetworkDOI() {

  if(USER_NETWORK === "*") {
    return Element("doi-link").innerHTML = "<small>Administrator</small>";
  }

  const API_ADDRESS = "https://www.orfeus-eu.org/api/doi";
  const DOI_API_QUERY = "network=" + USER_NETWORK;

  // Query the ORFEUS API for the network DOI
  $.ajax({
    "url": API_ADDRESS + "?" + DOI_API_QUERY,
    "method": "GET",
    "dataType": "JSON",
    "success": function(json) {

      if(!json) {
        return Element("doi-link").innerHTML = "<span class='fa fa-globe'></span> " + USER_NETWORK
      }

      console.debug("DOI returned from FDSN: " + json[USER_NETWORK]);

      Element("doi-link").innerHTML = "<a title='" + json[USER_NETWORK] + "' href='" + json[USER_NETWORK] + "'><span class='fa fa-globe'></span> " + USER_NETWORK + "</a>";

    }
  });

}

var App = function() {

  getNetworkDOI();

  // Initialize the map
  initApplication();

}

function generateLatencyInformationContentColor(channel, latency) {

  /* generateLatencyInformationContentColor
   * 
   */

  const COLOR_CODES = [
    "muted",
    "success",
    "info",
    "warning",
    "danger"
  ];

  // Number of seconds for a record to fill
  var index = getLatencyStatus(channel, latency);

  return COLOR_CODES[index];

}

function getLatencyStatusMarker(marker) {

  // Markers
  const STATION_MARKERS = [
    STATION_MARKER_GREY,
    STATION_MARKER_GREEN,
    STATION_MARKER_ORANGE,
    STATION_MARKER_RED
  ];

  var stationIdentifier = marker.title;

  // When the station is in the latency hashmap
  if(_hashMap.hasOwnProperty(stationIdentifier)) {

    // Get the average of all channel statuses
    a = Average(Object.keys(_hashMap[stationIdentifier]).map(function(channel) {

      return Average(_hashMap[stationIdentifier][channel].map(function(x) {
        return getLatencyStatus(channel, x.msLatency);
      }));

    }));

    return STATION_MARKERS[Math.round(a)];

  }

  // No information
  return STATION_MARKER_GREY;

}

function getLatencyStatus(channel, latency) {

  /* getLatencyStatus
   * returns the grade of latency status
   * dependent on channel type:
   *   0 UNKNOWN
   *   1 GREEN
   *   2 ORANGE
   *   3 RED
   */

  const S_UNKNOWN = 0;
  const S_GREEN = 1;
  const S_ORANGE  = 2;
  const S_RED = 3;

  // Limits
  const VLOW_RATE = 1E3;
  const LOW_RATE = 1E6;
  const BROAD_RATE = 2.5E4;
  const HIGH_RATE = 1E4;

  if(channel.startsWith("V")) {
    return (latency / VLOW_RATE) < 1 ? S_GREEN : S_RED;
  } else if(channel.startsWith("L")) {
    return (latency / LOW_RATE) < 1 ? S_GREEN : S_RED;
  } else if(channel.startsWith("B")) {
    return (latency / BROAD_RATE) < 1 ? S_GREEN : S_RED;
  } else if(channel.startsWith("H")) {
    return (latency / HIGH_RATE) < 1 ? S_GREEN : S_RED;
  }

  return S_UNKNOWN;

}

function generateLatencyInformationContent(latencies) {

  /* fuction generateLatencyInformationContent
   */
  var channels = _channelJson.map(function(x) {
    return x.channel;
  });

  return latencies.map(function(x) {
    return [
      (channels.indexOf(x.channel) === -1 ? Icon("exclamation", "danger") : "") + " " + x.location + "." + x.channel,
      x.end,
      "<span class='text-" + generateLatencyInformationContentColor(x.channel, x.msLatency) + "'><b>" + (1E-3 * x.msLatency).toFixed(1) + "</b></span>"
    ];
  });

}


String.prototype.capitalize = function() {
  return this.charAt(0).toUpperCase() + this.slice(1);
}

function generateBreadcrumb(pathname) {

  var crumbs = pathname.split("/").slice(1);

  if(crumbs.length === 1) {
    return "";
  }

  return [
    "<ol class='breadcrumb'>",
    generateBreadcrumbs(crumbs),
    "</ol>"
  ].join("\n");

}

function generateBreadcrumbs(crumbs) {

  /* function generateBreadcrumbs
   * Generates a HTML string for all breadcrumbs
   */

  // Keep full crumbling path
  var fullCrumb = "";

  return crumbs.map(function(x, i) {

     fullCrumb += "/" + x;

     x = x.capitalize();

     // Add an icon for home
     if(i === 0) {
       x = Icon("home") + " " + x;
     }

     // Add active class to the final crumb
     if(i === (crumbs.length - 1)) {
       return "<li id='final-crumb' class='breadcrumb-item active'>" + x + "</li>";
     } else {
      return "<li class='breadcrumb-item'><a href='" + fullCrumb + "'>" + x + "</a></li>";
     }

  }).join("\n");

}


function createLatencyHashmap(latencies) {

  /* Function createLatencyHashmap
   * Creates hashmap of all station latencies
   */

  var start = Date.now();

  var hashMap = new Object();

  // Go over the array
  latencies.forEach(function(x) {
    var identifier = x.network + "." + x.station;
    if(!hashMap.hasOwnProperty(identifier)) {
      hashMap[identifier] = new Object();
    }
    var chaIdentifier = x.channel.charAt(0);
    if(!hashMap[identifier].hasOwnProperty(chaIdentifier)) {
      hashMap[identifier][chaIdentifier] = new Array();
    }
    hashMap[identifier][chaIdentifier].push({"msLatency": x.msLatency, "channel": x.channel});
  })

  console.debug("Latency hashmap generated in " + (Date.now() - start) + " ms.");

  return hashMap;

}

// Create a closure around console.debug
console.debug = (function(fnClosure) {
  return function(msg) {
    if(__DEBUG__) {
      fnClosure(msg);
    }
  }
})(console.debug);

function GenerateTable(list) {

  /* function GenerateTable
   * 
   */

  $.ajax({
    "url": "/api/latency?network=" + USER_NETWORK,
    "type": "GET",
    "dataType": "JSON",
    "error": function(error) {
      GenerateTableFull(list, new Array());
      AddSeedlink();
    },
    "success": function(json) {
      GenerateTableFull(list, json);
      AddSeedlink();
    }
  });

}


function Sum(array) {

  /* function Sum
   * returns the average of an array
   */

  return array.reduce(function(a, b) {
    return a + b;
  }, 0);

}

function Average(array) {

  /* function Average
   * returns the average of an array
   */

  return Sum(array) / array.length;

}

function AverageLatencyLight(code, x) {

  /* function AverageLatencyLight
   * Returns the average latency for a group of channels with the same code
   */

  // Get the average latency for this particular channel
  var average = Average(x.map(function(x) {
    return x.msLatency;
  }));

  // Generate HTML
  return [
    "<span title='" + channelCodeToDescription(code, average) + "' class='fa fa-exclamation-circle text-" + generateLatencyInformationContentColor(code, average) + "'>",
      "<small style='font-family: monospace;'><b>" + code + "</b></small>",
    "</span>",
  ].join("\n");

}

function channelCodeToDescription(code, average) {

  /* function channelCodeToDescription
   * Maps channel code (e.g. V, L, B, H) to readable description
   */

  var average = average.toFixed(0) + "ms";

  switch(code) {
    case "V":
      return "Very Low Sampling Rate (" + average + ")";
    case "L":
      return "Low Sampling Rate (" + average + ")";
    case "B":
      return "Broadband Sampling Rate (" + average + ")";
    case "H":
      return "High Sampling Rate (" + average + ")";
    default:
      return "Unknown Channel (" + average + ")";
  }

}

function createLatencyTrafficLight(hashMap, x) {

  /* function createLatencyTrafficLight
   * Returns traffic light color of latency status
   */

  var stationIdentifier = [x.network, x.station].join(".");

  // If the station exists loop over all grouped channels
  if(hashMap.hasOwnProperty(stationIdentifier)) {
    return Object.keys(hashMap[stationIdentifier]).map(function(channel) {
      return AverageLatencyLight(channel, hashMap[stationIdentifier][channel]);
    }).join("\n");
  }

  // There is no information
  return Icon("circle", "muted");

}

function isStationPermanent(station) {

  /* function isStationPermanent
   * Returns true if a station is permanently deployed
   */

  var parsedEnd = Date.parse(station.end);

  return isNaN(parsedEnd);

}

function isStationActive(station) {

  /* function isStationActive
   * Returns true if a station is operational
   */

  var parsedEnd = Date.parse(station.end);

  return isNaN(parsedEnd) || parsedEnd > Date.now();

}

function isActive(station) {

  // Station is open
  if(isStationActive(station)) {
    return Icon("check", "success"); 
  }

  // Station is closed
  return Icon("remove", "danger");

}

function GenerateTableFull(list, latencies) {

  // Create a hash map of the latencies for quick look-up
  _hashMap = createLatencyHashmap(latencies);

  var list = list.map(function(x) {

    var parsedEnd = Date.parse(x.end);

    return [
      "&nbsp; " + createLatencyTrafficLight(_hashMap, x),
      x.network,
      x.station,
      x.description,
      x.position.lat,
      x.position.lng,
      x.elevation,
      isActive(x),
      "<a href='./home/station?network=" + x.network + "&station=" + x.station + "'>View & Manage</a>"
    ];
  });

  // Cache
  __TABLE_JSON__ = list;

  MakeTable();

}

function MakeTable() {

  const TABLE_HEADER = [
    "Channel Status",
    "Network",
    "Station",
    "Description",
    "Latitude",
    "Longitude",
    "Elevation",
    "Open",
    "Station Details"
  ];

  // Get the list (filtered)
  new Table({
    "id": "table-container",
    "search": true,
    "header": TABLE_HEADER,
    "body": __TABLE_JSON__
  });

}

function generateAccordionContent(list) {

  /* generateAccordionContent
   * 
   */

  chartPointers = new Object();

  return list.filter(accFilter).map(function(x, i) {
    return [
      "<div class='card'>",
        "<div class='card-header small' role='tab' id='heading-" + i + "'>",
            "<button class='btn btn-link' data-toggle='collapse' data-target='#collapse-" + i + "' aria-expanded='true' aria-controls='collapse-" + i + "'>",
            Icon("caret-right") + " " + (x.location ? x.location + "." : "") + x.channel,
            "</button>",
            "<span class='heartbeat' id='heartbeat-" + x.location + "-" + x.channel + "'></span>",
            "<span class='text-danger'>" + (isStationActive(x) ? " " : " " + Icon("lock") + " Channel closed since " + x.end + "</span>"),
        "</div>",
        "<div id='collapse-" + i + "' class='collapse' role='tabpanel' aria-labelledby='heading-" + i + "' data-parent='#accordion'>",
          "<div class='card-block'>",
            generateAccordionContentChannelString(x),
          "</div>",
        "</div>",
      "</div>",
    ].join("\n");
  }).join("\n");

}

function accFilter(channel) {
  return !(!document.getElementById("hide-channels").checked && !isStationActive(channel));

}

function generateAccordionContentChannelString(channel) {

  // Static table do not use Table class
  var tableHTML = [
    "<table class='table table-sm table-striped'>",
    "<thead><tr><th>Sensor</th><th>Unit</th><th>Sampling Rate</th><th>Gain</th></tr></thead>",
    "<tbody><tr><td>" + channel.description + "</td><td>" + channel.sensorUnits + "</td><td>" + channel.sampleRate + "</td><td>" + channel.gain + "<td></td></tr></tbody>",
    "</table>"
  ].join("\n");

  return [
    "Channel <b>" + (channel.location ? channel.location + "." : "") + channel.channel + "</b>",
    "<small>(" + channel.start + " - " + (isStationActive(channel) ? "present" : channel.end) + ")</small>",
    "<p>",
    tableHTML, 
    "<div class='seedlink-container' id='seedlink-container-" + channel.location + "-" + channel.channel + "'>",
      "<div class='info'></div>",
      "<div class='chart'></div>",
    "</div>",
    "<hr>",
    //"<button class='btn btn-link'>" + Icon("eye") + "<small> View Instrument Response</small></button>",
    "<a target='_blank' href='https://www.orfeus-eu.org/fdsnws/station/1/query?level=response&cha=" + channel.channel + "&net=" + channel.network + "&sta=" + channel.station + "'>" + Icon("download") + "<small> Download Instrument Response (StationXML) </small></a>"
  ].join("\n");

}

function generateAccordion(list) {

  return [
    "<div id='accordion'>",
    generateAccordionContent(list),
    "</div>"
  ].join("\n");

}

function downloadKML() {

  /* function downloadKML
   * Opens download for station metata in KML format
   */

   function generateKML() {
   
     /* function generateKML
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

  XMLString = [
    "<?xml version='" + XML_VERSION + "' encoding='" + XML_ENCODING + "'?>",
    "<kml xmlns='http://earth.google.com/kml/" + KML_VERSION + "'>",
    generateKML(),
    "</kml>"
  ].join("\n");

  var dataStr = "data:text/xml;charset=utf-8," + encodeURIComponent(XMLString);
  download("stations.kml", dataStr);

}

function download(name, string) {

  /* function download
   * Creates a temporary link component used for downloading
   * encoded data
   */

  var downloadAnchorNode = document.createElement("a");
  downloadAnchorNode.setAttribute("href", string);
  downloadAnchorNode.setAttribute("download", name);
  downloadAnchorNode.click();
  downloadAnchorNode.remove();

}

function downloadTable() {

  var dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(_stationJson));
  download("stations.json", dataStr);

}

function AddMetadataUpload() {

  /* function AddMetadataUpload
   * Adds event to metadata uploading
   */

  // Add event handler when files are selected 
  Element("file-stage").addEventListener("change", function(event) {

    // Always disable submission button initially
    // It will be released after the StationXML has been verified
    Element("file-submit").disabled = true;

    // Abstracted function to read multiple files from event
    readMultipleFiles(Array.from(event.target.files), function(files) {

      // Attempt to validate the StationXML metadata in the files
      try {
        var stagedStations = validateFiles(files);
      } catch(exception) {
        return Element("file-help").innerHTML = "<b>" + Icon("remove", "danger") + "</span> " + exception;
      }

      // Allow metadata submission
      Element("file-submit").disabled = false;

      // Generate the content
      var stagedFileContent = stagedStations.map(function(x) {
        return (x.new ? Icon("star", "warning") + " " : "") + x.network + "." + x.station
      }).join(", ");

      Element("file-help").innerHTML = "<b>" + Icon("check", "success") + "</span> Staged Metadata:</b> " + (stagedStations.length ? stagedFileContent : "None"); 

    });

  });

}

function readMultipleFiles(files, callback) {

  /* function readMultipleFiles
   * Uses the HTML5 FileReader API to read mutliple fires and fire
   * a callback with its contents
   */

  var fileContents = new Array();

  // IIFE to read multiple files
  (read = function(file) {

    var reader = new FileReader();

    // XML should be readable as text
    reader.readAsText(file);

    // Callback when one file is read
    reader.onload = function() {

      console.debug("FileReader read file " + file.name + " (" + file.size + " bytes)");

      // Append the result
      fileContents.push({
        "data": reader.result,
        "size": file.size
      });

      // Last file has been read
      if(!files.length) {
        return callback(fileContents);
      }

      // More files to read: continue
      read(files.pop());

    }

  })(files.pop());

}

function parseQuery(queryString) {

  var query = new Object;
  var pairs = (queryString[0] === "?" ? queryString.substr(1) : queryString).split("&");

  for(var i = 0; i < pairs.length; i++) {
    var pair = pairs[i].split('=');
    query[decodeURIComponent(pair[0])] = decodeURIComponent(pair[1] || '');
  }

  return query;

}

new App();


const __DEBUG__ = true;
const STATION_MARKER_GREEN = "/images/station-green.png";
const STATION_MARKER_ORANGE = "/images/station-orange.png";
const STATION_MARKER_GREY = "/images/station-grey.png";
const STATION_MARKER_RED = "/images/station-red.png";
const NODE_MARKER = "/images/node.png";
const SOCKET_URL = "ws://127.0.0.1:8080";
const LATENCY_SERVER = "http://127.0.0.1:3001";
const ITEMS_PER_PAGE = 75;

var __TABLE_JSON__;
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
  map = new google.maps.Map(Element("map"));

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
    "url": LATENCY_SERVER + query, 
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      console.debug("Retrieved " + json.length + " latencies from " + LATENCY_SERVER + query +  " in " + (Date.now() - start) + " ms.");

      const LATENCY_TABLE_HEADER = [
        "Channel",
        "Last Record",
        "Latency (ms)"
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

    $.ajax({
      "url": "/api/messages",
      "type": "GET",
      "dataType": "JSON",
      "success": function(json) {

        console.debug("Retrieved " + json.length +  " message(s) from server.");

        var MESSAGE_TABLE_HEADER = [
          "Subject",
          "Recipient",
          "Message Received"
        ];

        var sent = json.filter(function(x) {
          return x.author;
        });

        new Table({
          "id": "message-content-sent",
          "search": true,
          "header": MESSAGE_TABLE_HEADER,
          "body": generateMessageTableContentSent(sent)
        });

        var MESSAGE_TABLE_HEADER = [
          "Subject",
          "Sender",
          "Message Received"
        ];

        var inbox = json.filter(function(x) {
          return !x.author;
        });

        new Table({
          "id": "message-content",
          "search": true,
          "header": MESSAGE_TABLE_HEADER,
          "body": generateMessageTableContent(inbox)
        });

      }

    });

  }

  if(uri.pathname === "/home/station") {

    AddMap();

    // Hoist an empty socket
    __SOCKET__ = null

    // Change event to toggle WS connection
    Element("connect-seedlink").addEventListener("change", function() {

      // Not connected and socket is empty
      if(!Element("connect-seedlink").checked && __SOCKET__) {
        __SOCKET__.disconnect();
        return;
      } else {
        __SOCKET__ = io(SOCKET_URL);
      }

      __SOCKET__.on("disconnect", function() {
        console.debug("Disconnected socket from " + SOCKET_URL);
        __SOCKET__ = null;
      });

      __SOCKET__.on("connect", function() {
        __SOCKET__.emit("subscribe", "broad"); 
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
  
    getStationLatencies(uri.search);

    $.ajax({
      "url": "/api/channels" + uri.search,
      "type": "GET",
      "dataType": "JSON",
      "success": function(json) {

        _channelJson = json;

        document.getElementById("channel-information").innerHTML = generateAccordion(_channelJson);

        document.getElementById("hide-channels").addEventListener("change", function() {
          document.getElementById("channel-information").innerHTML = generateAccordion(_channelJson);
        });

        var nOpen = json.filter(function(x) {
          var parsedEnd = Date.parse(x.end);
          return (isNaN(parsedEnd) || parsedEnd > Date.now());
        }).length;

        var station = json[0];

        var marker = new google.maps.Marker({
          "map": map,
          "icon": isStationActive(station) ? STATION_MARKER_GREEN : STATION_MARKER_ORANGE,
          "title": [station.network, station.station].join("."),
          "position": station.position
        }); 

        document.getElementById("channel-information-header").innerHTML = Icon("signal") + " " + marker.title;
        document.getElementById("map-information").innerHTML = "Map showing station <b>" + marker.title + "</b> with <b>" + nOpen + "</b> open channels.";

        // Event listener for clicks
        marker.addListener("click", function() {
          infowindow.close();
          infowindow.setContent("Station " + marker.title)
          infowindow.open(map, this);
        });

        map.setCenter(station.position);
        map.setZoom(12);

      }
    });

  }

  // Initialize map on the main home page
  if(uri.pathname === "/home") {

    // Send notification
    const E_METADATA_SERVER_ERROR = "There was an error receiving the metadata.";
    const S_METADATA_OK = "The metadata has been succesfully received.";

    switch(uri.search) {
      case "?success":
        Element("modal-content").innerHTML = generateMessageAlert("success", S_METADATA_OK);
        $("#modal-alert").modal();
        break;
      case "?failure":
        Element("modal-content").innerHTML = generateMessageAlert("danger", E_METADATA_SERVER_ERROR);
        $("#modal-alert").modal();
        break;
    }

    // Add map
    AddMap();

    // Add upload button for metadata
    AddMetadataUpload();

    var markers = new Array();
    var start = Date.now();

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
      (x.read ? "&nbsp; <span class='fa fa-envelope-open text-danger'></span> " : "&nbsp; <span class='fa fa-envelope text-success'></span><b> ") + "&nbsp; <a href='/home/messages/details?read=" + x._id + "'>" + x.subject + "</b></a>",
      formatMessageSender(x.recipient),
      x.created
    ];
  });

}

function generateMessageTableContent(json) {

  return json.map(function(x) {
    return [
      (x.read ? "&nbsp; <span class='fa fa-envelope-open text-danger'></span> " : "&nbsp; <span class='fa fa-envelope text-success'></span><b> ") + "&nbsp; <a href='/home/messages/details?read=" + x._id + "'>" + x.subject + "</b></a>",
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
    "url": "/api/messages/details" + location.search.replace("read", "delete"),
    "type": "GET",
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

  const API_ADDRESS = "https://www.orfeus-eu.org/api/doi";
  const DOI_API_QUERY = "network=" + USER_NETWORKS.join(",");

  // Query the ORFEUS API for the network DOI
  $.ajax({
    "url": API_ADDRESS + "?" + DOI_API_QUERY,
    "method": "GET",
    "dataType": "JSON",
    "success": function(json) {

      if(json === undefined || json && json["doi-link"] === null) {
        return Element("doi-link").innerHTML = "<span class='fa fa-globe'> " + USER_NETWORKS.join(" ") + "</span>";
      }

      console.debug("DOI returned from FDSN: " + json["doi-link"]);

      Element("doi-link").innerHTML = "<a title='" + json["doi-link"] + "' href='" + json["doi-link"] + "'><span class='fa fa-globe'> " + USER_NETWORKS.join(" ") + "</span></a>";

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
  const BROAD_RATE = 1E5;
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

  return latencies.map(function(x) {
    return [
      x.location + "." + x.channel,
      x.end,
      "<span class='text-" + generateLatencyInformationContentColor(x.channel, x.msLatency) + "'>" + x.msLatency + "</span>"
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


function generateTableHeadContent(header) {
  return header.map(AddTagTH).join("\n");
}

function AddTagOption(x) {
  return AddTag("option", x);
}

function AddTag(tag, x) {
  return "<" + tag + ">" + x + "</" + tag + ">";
}

function AddTagTD(x) {
  return AddTag("td", x);
}

function AddTagTH(x) {
 return AddTag("th", x);
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
    "url": "/api/latency",
    "type": "GET",
    "dataType": "JSON",
    "error": function(error) {
      GenerateTableFull(list, new Array());
    },
    "success": function(json) {
      GenerateTableFull(list, json);
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
    "<span title='" + channelCodeToDescription(code, average) + "' class='fa fa-check-circle text-" + generateLatencyInformationContentColor(code, average) + "'>",
      "<b style='font-family: monospace;'>" + code + "</b>",
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
    "Status",
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
            "<span id='heartbeat-" + x.location + "-" + x.channel + "'></span>",
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
    "<button class='btn btn-link'>" + Icon("eye") + "<small> View Instrument Response</small></button>",
    "<button class='btn btn-link'>" + Icon("download") + "<small> Download Instrument Response</small></button>"
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

function generateKML() {

  /* function generateKML
   * Generates KML string from station JSON for exporting
   */

  return _stationJson.map(function(x) {
    return [
      "<Placemark>",
      "<Point>",
      "<coordinates>" + x.position.lng + "," + x.position.lat + "</coordinates>",
      "</Point>",
      "<Network>" + x.network + "</Network>",
      "<description>" + x.description + "</description>",
      "<Station>" + x.station + "</Station>",
      "</Placemark>"
    ].join("\n");
  }).join("\n");

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

function filterStationTable(content) {

  /* function filterStationTable
   * Filter input on network & station name
   */

  // Rows for network & station names
  const NETWORK_NAME_ROW = 1;
  const STATION_NAME_ROW = 2;

  // Get the filter value from the DOM and create a regular expression
  var filterValue = document.getElementById("table-search").value;
  var regex = new RegExp("^.*" + filterValue + ".*$");

  return content[NETWORK_NAME_ROW].match(regex) || content[STATION_NAME_ROW].match(regex);

}

function generateTableBodyContent(body) {

  /* function generateTableBodyContent
   * 
   */
  const startSlice = ITEMS_PER_PAGE * ACTIVE_PAGE_INDEX;
  const endSlice = startSlice + ITEMS_PER_PAGE;

  // Slice the data from memory to what is visible & unfiltered
  return body.slice(startSlice, endSlice).map(function(x) {
    return "<tr>" + generateTableRowContent(x) + "</tr>"
  }).join("\n");

}

function filterBodyContent(body) {

  /* function filterBodyContent
   * Filters the body content based
   */

  // Search input is empty
  if(document.getElementById("table-search").value === "") {
    return body;
  }

  var start = Date.now();

  var contents = body.filter(filterStationTable);

  console.debug("Filtered " + (body.length - contents.length) + " entries from table in " + (Date.now() - start) + " ms");

  // Return the filtered results
  return contents;

}

// Global object for keeping pointers to chart objects
chartPointers = new Object();
var nPointsBuffered = 512;

/* Class SeedlinkChannel
 *
 * Class for handling individual seedlink channels
 */
var SeedlinkChannel = function(data) {

  var id = data.id.split(".").join("-");

  // Append the chart container to the list
  // Zero-fill the intial buffer
  this.CreateZeroBuffer(data.start, data.sampleRate, data.data[0]);

  this.container = "seedlink-container-" + data.location + "-" + data.channel;

  this.chartContainer = $("#" + this.container + " .chart");

  // Remove the parent div on clicking the delete button
  // Update the data received through the socket 
  this.Update(data);

}

/* Property SeedlinkChannel.Containers
 *
 * Quick reference to the seedlink channel container
 */
SeedlinkChannel.prototype.CreateZeroBuffer = function(start, rate, value) {

  this.dataBuffer = new Array();

  // Backwards zero fill with the initial value
  for(var i = 0; i < nPointsBuffered; i++) {
    this.dataBuffer.push({
      "x": start - ((nPointsBuffered - i) * (1000 / rate)),
      "y": value
    });
  }

}

/* Function SeedlinkChannel.AddBuffer
 *
 * Add data to the buffer
 */
SeedlinkChannel.prototype.AddBuffer = function(data, sampleRate) {

  for(var i = 0; i < data.length; i++) {
    this.dataBuffer.push({
      'x': this.start + (i * (1000 / sampleRate)),
      'y': data[i]
    });
  }

  // Keep a maximum of $nPointsBuffered points in the buffer
  this.dataBuffer.splice(0, this.dataBuffer.length - nPointsBuffered);

}

/* Function SeedlinkChannel.UpdateTooltip
 *
 * Update the information string above the chart
 */
SeedlinkChannel.prototype.UpdateTooltip = function() {

  // Determine the latency by taking the current date
  // and substracting the expected record end
  var latency = Math.max(0, 1E-3 * (new Date().getTime() - this.end));

  // Construct the tooltip
  var tooltip = [
    "<b>" + this.container.split("-").join("."),
    "</b><small> with <b>",
    latency.toFixed(2),
    "s</b> latency",
    " @ <b>", new Date().toISOString(),
    " </b><span class='fa fa-heart' aria-hidden='true'></span></small>"
  ].join("");

}

/* Function SeedlinkChannel.Update
 *
 * Updates the data buffer with new data and
 * redraws the chart
 */
SeedlinkChannel.prototype.Update = function(data) {

  var bufferedValues = new Array();

  this.start = data.start;
  this.latency = data.latency;

  var d = document.getElementById("heartbeat-" + data.location + "-" + data.channel);
  if(d !== null) {
    d.innerHTML = "<span class='fa fa-heart text-success' aria-hidden='true'><b> Heartbeat</b></span>";
    setTimeout(function() {
      d.innerHTML = "";
    }, 1000);
  }

  // Currently expected endtime is different from the next
  // record start time; introduce a gap
  if(this.end && this.end !== data.start) {
    this.dataBuffer.push({
      "x": this.end,
      "y": null
    }); 
  }

  this.AddBuffer(data.data, data.sampleRate);

  this.end = data.end;

  this.Plot();

}

/* Function SeedlinkChannel.Plot
 *
 * Calls Highcharts plotting routing on data buffer
 */
SeedlinkChannel.prototype.Plot = function() {

  // Update the tooltip
  this.UpdateTooltip();

  // Redraw the chart container
  this.chartContainer.highcharts({
    "chart": {
      "height": 100,
      "backgroundColor": null,
      "animation": false,
      "type": "spline",
    },
    "title": {
      "text": "",
    },
    "xAxis": {
      "type": "datetime",
      "lineWidth": 1,
      "labels": {
        "style": {
          "fontFamily": "Helvetica"
        }
      }
    },
    "yAxis": {
      "visible": false,
      "title": {
        "text": "Counts"
      }
    },
    "plotOptions": {
      "spline": {
        "lineWidth": 1,
        "shadow": true,
        "turboThreshold": 0,
        "lineColor": "#C03",
        "animation": false,
        "marker": {
          "enabled": false
        }
      }
    },
    "credits": {
      "enabled": false
    },
    "legend": {
        "enabled": false
    },
    "exporting": {
        "enabled": false
    },
    "series": [{
        "name": this.container,
        "enableMouseTracking": false,
        "data": this.dataBuffer
    }]
  });

}

function validateFiles(files) {

  /* function validateFiles
   * validates uploaded StationXML files
   * throws an exception on formatting error
   */

  const FDSN_STATION_XML_HEADER = "FDSNStationXML";
  const NETWORK_REGEXP = new RegExp(/^[a-z0-9]{1,2}$/i);
  const STATION_REGEXP = new RegExp(/^[a-z0-9]{1,5}$/i);
  const XML_MIME_TYPE = "text/xml";

  var stagedStations = new Array();

  // Map of stations included by FDSN webservice
  var stationsMap = _stationJson.map(function(x) {
    return x.station;
  });

  // Validate each file
  files.forEach(function(file) {
  
    // Parse the XML using the native DOMParser
    var XML = new DOMParser().parseFromString(file.data, XML_MIME_TYPE);

    // Confirm that XML owns the FDSNStationXML namespace
    if(XML.documentElement.nodeName !== FDSN_STATION_XML_HEADER) {
      throw("Invalid FDSN Station XML");
    }

    // Go over all networks and collect station names
    Array.from(XML.getElementsByTagName("Network")).forEach(function(network) {

      var networkCode = network.getAttribute("code");

      // Confirm network regex & user must own network
      if(!NETWORK_REGEXP.test(networkCode) || USER_NETWORKS.indexOf(networkCode) === -1) {
        throw("Invalid network code: " + networkCode);
      }

      Array.from(network.getElementsByTagName("Station")).forEach(function(station) {

        var stationCode = station.getAttribute("code");

        if(!STATION_REGEXP.test(stationCode)) {
          throw("Invalid station code: " + stationCode);
        }

        // Detailed sanization check on station metadata
        validateStationMetadata(station);

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
    readMultipleFiles(event.target.files, function(files) {

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
        return (x.new ? Icon("star", "warning") : "") + x.network + "." + x.station
      }).join(", ");

      Element("file-help").innerHTML = "<b>" + Icon("check", "success") + "</span> Staged Metadata:</b> " + (stagedStations.length ? stagedFileContent : "None"); 

    });

  });

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

function readMultipleFiles(files, callback) {

  /* function readMultipleFiles
   * Uses the HTML5 FileReader API to read mutliple fires and fire
   * a callback with its contents
   */

  var fileContents = new Array();
  var files = Array.from(files);

  // IIFE to read multiple files
  (read = function(file) {

    var reader = new FileReader();

    // XML should be readable as text
    reader.readAsText(file);

    // Callback when one file is read
    reader.onload = function() {

      console.debug("FileReader read file " + file.name + " (" + file.size + " bytes)");

      // Append the result
      fileContents.push({"data": reader.result, "size": file.size});

      // Last file has been read
      if(!files.length) {
        return callback(fileContents);
      }

      // More files to read: continue
      read(files.pop());

    }

  })(files.pop());

}

new App();

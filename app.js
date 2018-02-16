const __DEBUG__ = true;
const SOCKET_URL = "ws://127.0.0.1:8080";
const LATENCY_SERVER = "http://127.0.0.1:3001";
const ITEMS_PER_PAGE = 75;

const NODES = [{
  "name": "ORFEUS Data Center",
  "position": {
    "lat": 52.10165,
    "lng": 5.1783
  }
}]

var __TABLE_JSON__;
var _stationJson;
var _channelJson;
var ACTIVE_PAGE_INDEX = 0;
var map, infowindow;

function AddMap() {

  var start = Date.now();

  infowindow = new google.maps.InfoWindow();
  map = new google.maps.Map(document.getElementById("map"));

  // Listener on map to close the info window
  map.addListener("click", function() {
    infowindow.close();
  });

  // Add the EIDA nodes
  NODES.forEach(function(node) {

    var marker = new google.maps.Marker({
      "map": map,
      "position": node.position,
      "title": "ORFEUS Data Center",
      "icon": "/images/node.png",
      "zIndex": 100
    });

    // Add listener to the EIDA nodes
    marker.addListener("click", function() {
      infowindow.close();
      infowindow.setContent("EIDA Node <hr>" + marker.title)
      infowindow.open(map, this);
    });

  });

  console.debug("Map has been initialized in " + (Date.now() - start) + " ms.");

}

function newMessageNotification() {

  var start = Date.now();

  // Make a request to get the number of new messages
  $.ajax({
    "cache": false,
    "url": "/api/messages?new",
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      console.debug("Retrieved " + json.count + " new message(s) from server in " + (Date.now() - start) + " ms.");

      // Update HTML notification for number of messages
      if(json.count === 0) {
        document.getElementById("number-messages").innerHTML = "No new messages!";
      } else if(json.count === 1) {
        document.getElementById("number-messages").innerHTML = "1 new message!";
      } else {
        document.getElementById("number-messages").innerHTML = json.count + " new messages!";
      }

    }

  });

}

function getStationLatencies(query) {

  var start = Date.now();

  $.ajax({
    "url": LATENCY_SERVER + query, 
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {

      console.debug("Retrieved " + json.latencies.length + " latencies from " + LATENCY_SERVER + query +  " in " + (Date.now() - start) + " ms.");

      document.getElementById("channel-information-latency").innerHTML = generateLatencyInformation(json);

    }

  });

}

function initMap() {

  /* function initMap
   * Initializes the application
   */

  var uri = new URL(window.location.href);

  console.debug("Initializing application at " + uri.href + ".");

  // Generate the breadcrumbs as a function of pathname
  document.getElementById("breadcrumb-container").innerHTML = generateBreadcrumb(uri.pathname); 

  // Get new notifications
  newMessageNotification();

  // Message details are requested
  if(uri.pathname === "/home/messages/details") {

    if(location.search === "") {
      return;
    }

    $.ajax({
      "url": "/api/messages/details" + location.search,
      "type": "GET",
      "dataType": "JSON",
      "success": function(json) {
        document.getElementById("message-detail").innerHTML = generateMessageDetails(json); 
      }
    });

  }

  /* Page for writing a new message
   */

  if(uri.pathname === "/home/messages/new") {

    const RECIPIENT_NOT_FOUND = "Recipient could not be found.";
    const MESSAGE_SUCCESS = "Private message has been succesfully sent.";
    const MESSAGE_FAILURE = "Private message could not be sent. Please try again later.";
    const MESSAGE_SELF = "Cannot send private message to yourself.";

    document.getElementById("final-crumb").innerHTML = "Create Message";

    if(uri.search === "?self") {
      document.getElementById("message-information").innerHTML = [
        "<div class='alert alert-danger'>",
        "  <span class='fa fa-remove aria-hidden='true'></span>",
        MESSAGE_SELF,
        "</div>"
      ].join("\n");
    }

    // Recipient unknown
    if(uri.search === "?unknown") {
      document.getElementById("message-information").innerHTML = [
        "<div class='alert alert-danger'>",
        "  <span class='fa fa-remove aria-hidden='true'></span>",
        RECIPIENT_NOT_FOUND,
        "</div>"
      ].join("\n");
    }

    // Success
    if(uri.search === "?success") {
      document.getElementById("message-information").innerHTML = [
        "<div class='alert alert-success'>",
        "  <span class='fa fa-check aria-hidden='true'></span>",
        MESSAGE_SUCCESS,
        "</div>"
      ].join("\n");
    }

    // Failure
    if(uri.search === "?failure") {
      document.getElementById("message-information").innerHTML = [
        "<div class='alert alert-danger'>",
        "  <span class='fa fa-remove aria-hidden='true'></span>",
        MESSAGE_FAILURE,
        "</div>"
      ].join("\n");
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

        document.getElementById("message-content-sent").innerHTML = [
          "<table class='table table-sm table-striped'>",
          generateTableHead(MESSAGE_TABLE_HEADER),
          generateTableBody(generateMessageTableContentSent(sent)),
          "</table>"
        ].join("\n");

        var MESSAGE_TABLE_HEADER = [
          "Subject",
          "Sender",
          "Message Received"
        ];

        var inbox = json.filter(function(x) {
          return !x.author;
        });

        // Generate the table content
        document.getElementById("message-content").innerHTML = [
          "<table class='table table-sm table-striped'>",
          generateTableHead(MESSAGE_TABLE_HEADER),
          generateTableBody(generateMessageTableContent(inbox)),
          "</table>"
        ].join("\n");

      }

    });

  }

  if(uri.pathname === "/home/station") {

    AddMap();

    // Hoist an empty socket
    __SOCKET__ = null

    // Change event to toggle WS connection
    document.getElementById("connect-seedlink").addEventListener("change", function() {

      // Not connected and socket is empty
      if(!document.getElementById("connect-seedlink").checked && __SOCKET__) {
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
          "icon": "/images/station.png",
          "title": [station.network, station.station].join("."),
          "position": station.position
        }); 

        document.getElementById("channel-information-header").innerHTML = IconSpan("signal") + " " + marker.title;
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

    if(uri.search.startsWith("?success")) {
      Element("modal-content").innerHTML = "<div class='text-success'><b>" + IconSpan("checkmark") + " The metadata has been succesfully received." + "</b></div>";
      $("#modal-alert").modal();
    }
    if(uri.search.startsWith("?failure")) {
      Element("modal-content").innerHTML = "<div class='text-danger'><b>" + IconSpan("unavailable") + " There was an error receiving the metadata." + "</b></div>";
      $("#modal-alert").modal();
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
            "icon": "./images/station.png",
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

        document.getElementById("map-information").innerHTML = MapInformationText(json.length);

        // Proceed with the table
        GenerateTable(json);

      }

    });

  }

}

function Element(id) {
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

function generateMessageDetails(message) {

  if(message === null) {
    return "<div class='alert alert-danger'> " + IconSpan("unavailable") + " Message not found. </div>";
  }

  console.debug("Retrieved message with id " + message._id + " from server.");

  document.getElementById("final-crumb").innerHTML = "Subject: " + message.subject;

  return [
    "<div class='card'>",
      "<div class='card-header'>",
        "<small style='float: right;'>Sent at " + IconSpan("clock") + " " + message.created + "</small>",
        "<h5><b><span class='fa fa-envelope-o'></span> " + message.subject + "</b></h5>",
      "</div>",
      "<div class='card-block'>",
      message.content,
      "<hr>",
      message.author ? "" : "<button class='btn btn-danger btn-sm' style='float: right;' onClick='deleteMessage()'><span class='fa fa-trash'></span> Delete Message</button>",
      "Sender: " + formatMessageSender(message.sender),
      "</div>",
    "</div>",
  ].join("\n");

}

function deleteAllMessages() {

  // Confirm deletion
  if(!confirm("Are you sure you want to delete all messages?")) {
    return;
  }

  // Instead of "read" we pass "delete" to the API with the same message identifier
  $.ajax({
    "url": "/api/messages?deleteall",
    "type": "GET",
    "dataType": "JSON",
    "success": function(json) {
      window.location.reload();
    }

  });

}

function deleteMessage() {

  /* function deleteMessage
   * Deletes message with a given identifier
   */

  // Confirm deletion
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
        return document.getElementById("message-detail").innerHTML = "<div class='alert alert-danger'> " + IconSpan("unavailable") + " Could not delete message. </div>";
      }

      document.getElementById("message-detail").innerHTML = "<div class='alert alert-success'>" + IconSpan("checkmark") + " Message has been deleted.</div>";
    }

  });

}

function formatMessageSender(sender) {

  /* function formatMessageSender
   * Returns specific formatting for particular senders (e.g. administrator)
   */

  if(sender.role === "admin") {
    return sender.username + " (<span class='text-danger'><b>O</span>RFEUS Administrator</b>)";
  }
 
  return sender.username;

}

function IconSpan(type) {

  switch(type) {
    case "grey-light":
      return "<span class='fa fa-circle text-muted'></span>";
    case "green-light":
      return "<span class='fa fa-circle text-success'></span>";
    case "orange-light":
      return "<span class='fa fa-circle text-warning'></span>";
    case "red-light":
      return "<span class='fa fa-circle text-danger'></span>";
    case "signal":
      return "<span class='fa fa-signal' aria-hidden='true'></span>";
    case "clock":
      return "<span class='fa fa-clock-o' aria-hidden='true'></span>";
    case "lock":
      return "<span class='fa fa-lock' aria-hidden='true'></span>";
    case "download":
      return "<span class='fa fa-download' aria-hidden='true'></span>";
    case "dropdown":
      return "<span class='fa fa-caret-right' aria-hidden='true'></span>";
    case "eye":
      return "<span class='fa fa-eye' aria-hidden='true'></span>";
    case "closed":
      return "<span class='fa fa-times-circle text-danger' aria-hidden='true'></span>";
    case "cog":
      return "<span class='fa fa-cog text-danger' aria-hidden='true'></span>";
    case "unavailable":
      return "<span class='fa fa-remove text-danger' aria-hidden='true'></span>";
    case "checkmark":
      return "<span class='fa fa-check text-success' aria-hidden='true'></span>";
    case "map":
      return "<span class='fa fa-map' aria-hidden='true'></span> &nbsp;";
    case "cloud":
      return "<span class='fa fa-cloud' aria-hidden='true'></span> &nbsp;";
    case "comment":
      return "<span class='fa fa-comment-o' aria-hidden='true'></span> &nbsp;";
    case "microchip":
      return "<span class='fa fa-microchip' aria-hidden='true'></span> &nbsp;";
    default:
      return "???";
  }

}

function GoogleMapsInfoWindowContent(marker) {
  return "<h5>" + IconSpan("cog") + " " + marker.title + "</h5><hr><p>" + marker.description + "<p><a href='/home/station?network=" + marker.network + "&station=" + marker.station + "'>View instrument details</a>"; 
}

function MapInformationText(nStations) {
  return "Map showing <b>" + nStations + "</b> stations.";
}

function getNetworkDOI() {

  const API_ADDRESS = "https://www.orfeus-eu.org/api/doi";
  const QUERY = "?network=" + USER_NETWORKS.join(",");

  // Query the ORFEUS API for the network DOI
  $.ajax({
    "url": API_ADDRESS + QUERY,
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

var App = function(location) {

  getNetworkDOI();

  // Initialize the map
  initMap();

}

function generateLatencyInformation(json) {

  var header = ["Channel", "Last Record", "Latency (ms)"];
  var list = generateLatencyInformationContent(json.latencies);

  // No latencies were returned
  if(json.latencies.length === 0) {
    return "<div class='alert alert-danger'> " + IconSpan("unavailable") + " Seedlink connection unavailable. </div>";
  }

  // Return formatted latency content
  return [
    "<h4><span class='fa fa-heart-o text-danger' aria-hidden='true'></span> Seedlink Health</h4>",
    "<table class='table table-sm table-striped'>",
    generateTableHead(header),
    generateTableBody(list),
    "</table>",
    "<small> Latencies created at " + IconSpan("clock") + " <b>" + json.created + "</b>.</small>"
  ].join("\n");

}

function generateLatencyInformationContentColor(channel, latency) {

  // Number of seconds for a record to fill
  const VLOW_RATE = 1E3;
  const LOW_RATE = 1E6;
  const BROAD_RATE = 1E5;
  const HIGH_RATE = 1E4;

  if(channel.startsWith("V")) {
    return (latency / VLOW_RATE) < 1 ? "success" : "danger";
  } else if(channel.startsWith("L")) {
    return (latency / LOW_RATE) < 1 ? "success" : "danger";
  } else if(channel.startsWith("B")) {
    return (latency / BROAD_RATE) < 1 ? "success" : "danger";
  } else if(channel.startsWith("H")) {
    return (latency / HIGH_RATE) < 1 ? "success" : "danger";
  }

  // Unknown channel
  return "muted";

}

function generateLatencyInformationContent(latencies) {

  return latencies.map(function(x) {

    var color = generateLatencyInformationContentColor(x.channel, x.msLatency);

    return [
      x.location + "." + x.channel,
      x.end,
      "<span class='text-" + color + "'>" + x.msLatency + "</span>"
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

  // Keep full crumbling path
  var fullCrumb = "";

  return crumbs.map(function(x, i) {

     fullCrumb += "/" + x;

     x = x.capitalize();

     // Add icon for home
     if(x === "Home") {
       x = "<span class='fa fa-home'></span> " + x;
     }

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
      GenerateTableFull(list, json.latencies);
    }

  });

}


function Sum(array) {

  /* function Sum
   * returns the average of an array
   */

  return array.reduce(function(a, b) {
    return a + b;
  });

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
  return IconSpan("grey-light");

}

function isActive(station) {

  // Parse the station end date
  var parsedEnd = Date.parse(station.end);

  // Station is open
  if(isNaN(parsedEnd) || parsedEnd > Date.now()) {
    return IconSpan("checkmark"); 
  }

  // Station is closed
  return IconSpan("unavailable");

}

function GenerateTableFull(list, latencies) {

  // Create a hash map of the latencies for quick look-up
  var hashMap = createLatencyHashmap(latencies);

  var list = list.map(function(x) {

    var parsedEnd = Date.parse(x.end);

    return [
      "&nbsp; " + createLatencyTrafficLight(hashMap, x),
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

  // Add information add footer
  document.getElementById("table-information").innerHTML = "Table showing <b>" + list.length + "</b> stations.";

  // Attach an event listener for table searching
  document.getElementById("table-search").addEventListener("input", MakeTable);

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
  var filteredList = filterBodyContent(__TABLE_JSON__);

  // Generate pagination
  document.getElementById("table-pagination").innerHTML = generatePagination(filteredList);

  document.getElementById("table-container").innerHTML = [
    "<table class='table table-sm table-striped'>",
    generateTableHead(TABLE_HEADER),
    generateTableBody(filteredList),
    "</table>"
  ].join("\n");

  Array.from(document.getElementsByClassName("page-item")).forEach(function(x) {
    x.addEventListener("click", updateTable.bind(x, filteredList.length));
  });

}

function updateTable(l) {

  if(this.children[0].innerHTML === "Next") {
    ACTIVE_PAGE_INDEX++;
  } else if(this.children[0].innerHTML === "Previous") {
    ACTIVE_PAGE_INDEX--;
  } else {
    ACTIVE_PAGE_INDEX = Number(this.children[0].innerHTML) - 1;
  }

  // 
  ACTIVE_PAGE_INDEX = Math.max(Math.min(Math.ceil(l / ITEMS_PER_PAGE) - 1, ACTIVE_PAGE_INDEX), 0);

  // Add class 
  Array.from(document.getElementsByClassName("page-item")).forEach(function(x) {
    x.className = "page-item";
    if((Number(x.children[0].innerHTML) - 1) === ACTIVE_PAGE_INDEX) {
      x.className += " active";
    }
  });

  // Update the table
  MakeTable();

}

function generatePaginationList(list) {

  // No results
  if(list.length === 0) { 
    return "<li class='page-item active'><span class='page-link'>1</span></li>";
  }

  if(ACTIVE_PAGE_INDEX * ITEMS_PER_PAGE > list.length) {
    ACTIVE_PAGE_INDEX = Math.floor(list.length / ITEMS_PER_PAGE);
  }

  return list.filter(function(_, i) {
    return (i % ITEMS_PER_PAGE === 0);
  }).map(function(_, i) {
    if(i === ACTIVE_PAGE_INDEX) {
      return "<li class='page-item active'><span class='page-link'>" + (i + 1) + "</span></li>";
    } else {
      return "<li class='page-item'><span class='page-link'>" + (i + 1) + "</span></li>";
    }
  }).join("\n");

}

function generateAccordionContent(list) {

  chartPointers = new Object();

  return list.filter(accFilter).map(function(x, i) {
    return [
      "<div class='card'>",
        "<div class='card-header small' role='tab' id='heading-" + i + "'>",
            "<button class='btn btn-link' data-toggle='collapse' data-target='#collapse-" + i + "' aria-expanded='true' aria-controls='collapse-" + i + "'>",
              IconSpan("dropdown") + " " + (x.location ? x.location + "." : "") + x.channel,
            "</button>",
            "<span id='heartbeat-" + x.location + "-" + x.channel + "'></span>",
            "<span class='text-danger'>" + (isClosed(x.end) ? " " : " " + IconSpan("lock") + " Channel closed since " + x.end + "</span>"),
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

function isClosed(date) {
  return (isNaN(Date.parse(date)) || Date.parse(date) > Date.now());
}

function accFilter(channel) {
  return !(!document.getElementById("hide-channels").checked && !isClosed(channel.end))

}

function generateAccordionContentChannelString(channel) {

  var parsedEnd = Date.parse(channel.end);
  var header = ["Sensor", "Unit", "Sampling Rate", "Gain"];

  var table = [
    "<table class='table table-sm table-striped'>",
    generateTableHead(header),
    generateTableBody([[channel.description, channel.sensorUnits, channel.sampleRate, channel.gain]]),
    "</table>"
  ].join("\n");

  return [
    "Channel <b>" + (channel.location ? channel.location + "." : "") + channel.channel + "</b>",
    "<small>(" + channel.start + " - " + ((isNaN(parsedEnd) || parsedEnd > Date.now()) ? "present" : channel.end) + ")</small>",
    "<p>",
    table, 
    "<div class='seedlink-container' id='seedlink-container-" + channel.location + "-" + channel.channel + "'>",
      "<div class='info'></div>",
      "<div class='chart'></div>",
    "</div>",
    "<hr>",
    "<button class='btn btn-link'>" + IconSpan("eye") + "<small> View Instrument Response</small></button>",
    "<button class='btn btn-link'>" + IconSpan("download") + "<small> Download Instrument Response</small></button>"
  ].join("\n");

}

function generateAccordion(list) {

  return [
    "<div id='accordion'>",
    generateAccordionContent(list),
    "</div>"
  ].join("\n");

}

function generatePagination(list) {

  /* function generatePagination
   * Generates the pagination for the active table
   */

  return [
   "<nav aria-label='Page navigation example'>",
     "<ul class='pagination'>",
       "<li class='page-item'><span class='page-link'>Previous</span></li>",
       generatePaginationList(list),
       "<li class='page-item'><span class='page-link'>Next</span></li>",
     "</ul>",
   "</nav>"
  ].join("\n");

}

function generateTableBody(body) {

  return [
    "  <tbody>",
    generateTableBodyContent(body),
    "  </tbody>"
  ].join("\n");

}

function generateTableHead(header) {

  return [
    "  <thead>",
    "    <tr>",
    generateTableHeadContent(header),
    "    </tr>",
    "  </thead>"
  ].join("\n");

}

function generateTableRowContent(row) {

  /* function generateTableRowContent
   * Generates single row content for a table
   */

  return row.map(function(x) {
    return "<td>" + x + "</td>"}
  ).join("\n");

}

function downloadKML() {

  XMLString = [
    "<?xml version='1.0' encoding='UTF-8'?>",
    "<kml xmlns='http://earth.google.com/kml/2.2'>",
    generateKML(),
    "</kml>"
  ].join("\n");

}

function generateKML() {

  /* function generateKML
   * Generates KML string for exporting
   */

  return _stationJson.map(function(x) {
    return [
      "<Placemark>",
      "<Point>",
      "<coordinates>" + x.position.lat + "," + x.position.lng + "</coordinates>",
      "</Point>",
      "</Placemark>",
      "<Network>" + x.network + "</Network>",
      "<description>" + x.description + "</description>",
      "<Station>" + x.station + "</Station>"
    ];
  }).join("\n");

}


function download(name, string) {

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

new App(window.location.href)

function AddMetadataUpload() {

  /* function AddMetadataUpload
   * Adds event to metadata uploading
   */

  const FDSN_STATION_XML_HEADER = "FDSNStationXML";
  const NETWORK_REGEXP = new RegExp(/^[a-z0-9]{1,2}$/i);
  const STATION_REGEXP = new RegExp(/^[a-z0-9]{1,5}$/i);

  // Change event when a file is selected
  Element("file-stage").addEventListener("change", function(event) {

    // Always disable submission button initially
    // It will be released after the StationXML has been verified
    Element("file-submit").disabled = true;

    // Abstracted function to read multiple files from even
    readMultipleFiles(event.target.files, function(files) {

      var stagedStations = new Array();

      var stationsMap = _stationJson.map(function(x) {
        return x.station;
      });

      for(var i = 0; i < files.length; i++) {

        var file = files[i];

        // Parse the XML using the native lib
        var XML = new DOMParser().parseFromString(file.data, "text/xml");

        // Confirm that XML has the FDSNStationXML namespace
        if(XML.documentElement.nodeName !== FDSN_STATION_XML_HEADER) {
          return Element("file-help").innerHTML = "<b>" + IconSpan("unavailable") + " Invalid FDSN StationXML.</b>";
        }

        // Go over all networks and collect station names
        var networks = Array.from(XML.getElementsByTagName("Network"));

        for(var j = 0; j < networks.length; j++) {

          var network = networks[j];
          var networkCode = network.getAttribute("code");

          if(!NETWORK_REGEXP.test(networkCode)) {
            return Element("file-help").innerHTML = "<b>" + IconSpan("unavailable") + " Invalid Network Code: " + networkCode + "</b>";
          }

          // Can only updated managed networks
          if(USER_NETWORKS.indexOf(networkCode) === -1) {
            return Element("file-help").innerHTML = "<b>" + IconSpan("unavailable") + " Invalid Network: " + networkCode + "</b>";
          }

          var stations = Array.from(network.getElementsByTagName("Station"));

          for(var k = 0; k < stations.length; k++) {

            var station = stations[k];
            var stationCode = station.getAttribute("code");

            if(!STATION_REGEXP.test(stationCode)) {
              return Element("file-help").innerHTML = "<b>" + IconSpan("unavailable") + " Invalid Station Code: " + stationCode + "</b>";
            }

            // Attempt to do sanization check on metadata
            try {
              validateMetadata(station);
            } catch(exception) {
              return Element("file-help").innerHTML = "<b>" + IconSpan("unavailable") + "</span> " + exception + " in " + networkCode + "." + stationCode + "</b>"; 
            }

            // Add star icon to new metadata
            if(stationsMap.indexOf(stationCode) === -1) {
              stagedStations.push("<span class='fa fa-star text-warning' title='New Metadata'></span> " + networkCode + "." + stationCode);
            } else {
              stagedStations.push(networkCode + "." + stationCode);
            }

          }

        }

      }

      // Allow metadata submission
      Element("file-submit").disabled = false;
      Element("file-help").innerHTML = "<b>" + IconSpan("checkmark") + "</span> Staged Metadata:</b> " + (stagedStations.length ? stagedStations.join(", ") : "None");

    });

  });

}

function validateMetadata(station) {

  /* function validateMetadata
   * Validates common StationXML issues
   */

  const GAIN_TOLERNACE_PERCENT = 0.001;

  // Confirm station spatial coordinates
  var stationLatitude = Number(station.getElementsByTagName("Latitude").item(0).innerHTML);
  var stationLongitude = Number(station.getElementsByTagName("Longitude").item(0).innerHTML);

  if(stationLatitude < -90 || stationLatitude > 90) {
    throw("Station latitude is incorrect");
  }

  if(stationLongitude < -180 || stationLongitude > 180) {
    throw("Station longitude is incorrect");
  }

  // Go over each channel for the station
  Array.from(station.getElementsByTagName("Channel")).forEach(function(channel) {

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
      throw("Response information not included in inventory");
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


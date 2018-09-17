/* App.js
 *
 * Client-side JavaScript code for EIDA Manager
 * 
 * Copyright: ORFEUS Data Center, 2018
 * Author: Mathijs Koymans
 * License: MIT
 *
 */

const __DEBUG__ = true;

const STATION_MARKER_GREEN = "/images/station-green.png";
const STATION_MARKER_ORANGE = "/images/station-orange.png";
const STATION_MARKER_GREY = "/images/station-grey.png";
const STATION_MARKER_RED = "/images/station-red.png";

const SOCKET_URL = "ws://0.0.0.0:8089"
const DOI_URL = "http://0.0.0.0:8090";

var chartPointers;
var _stationJson = new Array();
var _latencyHashMap = new Object();
var _channelJson = new Array();

var App = function() {

  /* Class App
   * Container for the EIDA Manager client side application
   */

  // Set the session network
  this.network = USER_NETWORK;

  this.queryString = parseQuery(window.location.search);

  // Initialize the map
  this.init();

}

function hideResponse() {

  Element("response-charts").style.display = "none";

}

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
  const FLAG_NORWAY = "&#x1F1F3;&#x1F1F4;";

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
  } else if(archive === "BER") {
    return FLAG_NORWAY;
  } else {
    return "";
  }

}

function HTTPRequest(url, callback) {

  /* Function HTTPRequest
   * Makes an async call to a remote resource
   * jQuery $.ajax is really annoying
   */

  var xhr = new XMLHttpRequest();

  // When the resource is ready
  xhr.onload = function() {

    // Ignore HTTP errors
    if(this.status !== 200) {
      return callback(null);
    }

    // Check the content type
    switch(this.getResponseHeader("Content-Type")) {
      case "application/json":
      case "application/vnd.schemaorg.ld+json":
        return callback(JSON.parse(xhr.response));
      default:
        return callback(xhr.response);
    }

  }

  xhr.onerror = function(error) {
    callback(null);
  }

  // Open and finish the request
  xhr.open("GET", url);
  xhr.send();

}

App.prototype.AddMap = function() {

  /* function AddMap
   * Initializes code for Google Maps application
   */

  var start = Date.now();

  this.map = new google.maps.Map(Element("map"), {
    "minZoom": 2,
    "disableDefaultUI": true
  });

  // Create a new infowindow for tooltips
  this.infowindow = new google.maps.InfoWindow();

  // Listener on map to close the info window
  this.map.addListener("click", function() {
    this.infowindow.close();
  }.bind(this));

  const NODES = [{
    "name": "ORFEUS Data Center",
    "id": "ODC",
    "position": {
      "lat": 52.10165,
      "lng": 5.1783
    }
  }, {
    "name": "Helmholz-Zentrum Potsdam",
    "id": "GFZ",
    "position": {
      "lat": 52.383,
      "lng": 13.066
    }
  }, {
    "name": "Reseau Sismologique & Geodesique Francais",
    "id": "RESIF",
    "position": {
      "lat": 45.1942,
      "lng": 5.7704
    }
  }, {
    "name": "Instituto Nazionale di Geofisica e Vulcanologia",
    "id": "INGV",
    "position": {
      "lat": 41.848,
      "lng": 12.5151
    }
  }, {
    "name": "ETH Zurich Schweizerischer Erdbebendienst",
    "id": "SED",
    "position": {
      "lat": 47.3788,
      "lng": 8.5472
    }
  }, {
    "name": "Bundensanstalt fur Geowissenschaften und Rohstoffe",
    "id": "BGR",
    "position": {
      "lat": 52.4048,
      "lng": 9.8214
    }
  }, {
    "name": "Ludwig Maximilians Universitat Munchen",
    "id": "LMU",
    "position": {
      "lat": 48.5014,
      "lng": 11.5806
    }
  }, {
    "name": "National Institute for Earth Physics",
    "id": "NIEP",
    "position": {
      "lat": 44.35,
      "lng": 26.02
    }
  }, {
    "name": "Kandilli Observatory and Earthquake Research Institute",
    "id": "KOERI",
    "position": {
      "lat": 41.063,
      "lng": 29.062
    }
  }, {
    "name": "National Observatory of Athens",
    "id": "NOA",
    "position": {
      "lat": 37.973259,
      "lng": 23.717904
    }
  }];

  // Add the EIDA nodes
  NODES.forEach(this.addNode.bind(this));

  console.debug("Map has been initialized in " + (Date.now() - start) + " ms.");

}

App.prototype.addNode = function(node) {

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

  /* function App.addNode
   * Adds a single EIDA node to the map
   */

  const NODE_MARKER = (node.id === CONFIG.NODE.ID) ? "/images/node-green.png" : "/images/node.png";
  const NODE_ZINDEX = 100;

  var marker = new google.maps.Marker({
    "map": this.map,
    "position": node.position,
    "id": node.id,
    "title": node.name, 
    "icon": NODE_MARKER,
    "zIndex": NODE_ZINDEX
  });

  // Add listener to the EIDA nodes
  marker.addListener("click", function() {

    this.infowindow.close();
    this.infowindow.setContent(generateNodeInfoWindow(marker));
    this.infowindow.open(this.map, marker);

  }.bind(this));

}

App.prototype.setupNotificationPolling = function() {

  /* Function App.setupNotificationPolling
   * Polls the api for new notifications
   */

  function generateNotificationMessage(count) {

    /* Function App.setupNotificationPolling::generateNotificationMessage
     * Generates HTML string for new messages
     */

    switch(count) {
      case 0:
        return "No new messages";
      case 1:
        return "1 new message";
      default:
        return count + " new messages";
    }

  }

  const NOTIFICATION_POLL_MS = 60000;

  var start = Date.now();

  // Make a request to get the number of new messages
  HTTPRequest("/api/messages?new", function(json) {

    console.debug("Retrieved " + (json ? json.count : 0) + " new message(s) from server in " + (Date.now() - start) + " ms.");

    // Show modal that user has new messages
    if(json.count > 0 && this.uri.search === "?welcome") {
      Element("modal-content").innerHTML = generateMessageAlert("success", "You have <b>" + json.count + "</b> unread message(s).");
      $("#modal-alert").modal();
    }

    Element("number-messages").innerHTML = generateNotificationMessage(json.count);

  }.bind(this));

  // Set next refresh for notification poll
  setTimeout(this.setupNotificationPolling, NOTIFICATION_POLL_MS);

}

App.prototype.getStationLatencies = function() {

  /* Function App.getStationLatencies
   * Queries the API for realtime latency information
   */

   function generateLatencyBody(latencies) {
  
    /* Fuction App.getStationLatencies::generateLatencyBody
     * Generates an array of formatted latency values
     */
  
    function generateLatencyText(x) {
  
      /* Function App.getStationLatencies::generateLatencyBody::generateLatencyText
       * Generates the span that holds the latency value
       */
  
      // Round the value to seconds (1 decimal)
      var value = (1E-3 * x.msLatency).toFixed(1);
  
      return [
        "<span style='display: block; text-align: right;' class='text-" + getLatencyColorClass(x.channel, x.msLatency) + "'>",
        "  <b>" + value + "</b>",
        "</span>"
      ].join("\n");
  
    }
  
    // Get a list of channel codes
    var availableChannels = _channelJson.map(function(x) {
      return x.channel;
    });
  
    var prefix;
  
    return latencies.map(function(x) {
  
      // If metadata is not avaible add a red exclamation marker
      if(availableChannels.indexOf(x.channel) === -1) {
        prefix = getIcon("exclamation", "danger");
      } else {
        prefix = "";
      }
  
      // Return a single table row
      return [prefix + " " + x.location + "."+ x.channel, x.end, generateLatencyText(x)];
  
    });
  
  }

  // Configuration for polling interval
  const LATENCY_POLL_MS = 60000;
  const LATENCY_TABLE_HEADER = ["Channel", "Last Record", "Latency (s)"];

  var start = Date.now();

  HTTPRequest("/api/latency" + window.location.search, function(json) {

    if(json === null) {
      return;
    }

    console.debug("Received " + json.length + " latencies in " + (Date.now() - start) + " ms.");

    // Create the channel latency table
    new Table({
      "id": "channel-information-latency",
      "search": false,
      "header": LATENCY_TABLE_HEADER,
      "body": generateLatencyBody(json)
    });

  });

  // Queue for next poll
  setTimeout(this.getStationLatencies, LATENCY_POLL_MS);

}

App.prototype.launchMessageDetails = function() {

  /* Function App.launchMessageDetails
   * Collects specific message from the API
   */

  function generateMessageDetails(message) {
  
    /* Function App.launchMessageDetails::generateMessageDetails
     * Collects specific message from the API
     */

    // No message was returned
    if(message === undefined) {
      return generateMessageAlert("danger", "Message not found.");
    }
  
    console.debug("Received message with id " + message._id + " from server.");

    // Update the final breadcrumb with the message subject
    updateCrumbTitle("Subject: " + message.subject);
  
    // Create a card for the message and contenet
    return [
      "<div class='card'>",
      "  <div class='card-header'>",
      "    <small style='float: right;'>Sent @ <b>" + message.created + "</b></small>",
      "    <h5><b><span class='fa fa-envelope-o'></span> " + message.subject + "</b></h5>",
      "  </div>",
      "  <div class='card-body'>",
      message.content,
      "    <hr>",
      "    <button class='btn btn-danger btn-sm' style='float: right;' onClick='deleteMessage()'><span class='fa fa-trash'></span> Delete Message</button>",
      (message.author ? "Recipient: " +  formatMessageSender(message.contact) : "Sender: " + formatMessageSender(message.contact)),
      "  </div>",
      "</div>",
    ].join("\n");
  
  }

  // No query was submitted
  if(window.location.search === "") {
    return;
  }

  // Get details from the API
  HTTPRequest("/api/messages/details" + window.location.search, function(json) {
    Element("message-detail").innerHTML = generateMessageDetails(json);
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
        return getIcon("times", "danger");
      case "warning":
        return getIcon("question", "warning");
      case "success":
        return getIcon("check", "success");
    }
  
  }

  return [
    "<div class='alert alert-" + type + "'>",
    getAlertIcon(type),
    message,
    "</div>"
  ].join("\n");

}

App.prototype.launchMessages = function() {

  /* Function App.launchMessages
   * Launches part of the application dealing with messages
   */

  function messageSubjectText(x) {
 
    /* Function App.launchMessages::messageSubjectText
     * Launches part of the application dealing with messages
     */

    return (x.read ? "&nbsp; <span class='fa fa-envelope-open text-danger'></span> " : "&nbsp; <span class='fa fa-envelope text-success'></span><b> ") + "&nbsp; <a href='/home/messages/details?id=" + x._id + "'>" + x.subject + "</b></a>";

  }

  function generateMessageTableContent(json) {
  
    /* Function App.launchMessages::generateMessageTableContent
     * Generates the table content of received messages
     */
  
    return json.map(function(x) {
      return [
        messageSubjectText(x),
        formatMessageSender(x.sender),
        x.created
      ];
    });
  
 }

  function generateMessageTableContentSent(json) {
  
    /* Function App.launchMessages::generateMessageTableContentSent
     * Generates the table content of sent messages
     */
  
    return json.map(function(x) {
      return [
        messageSubjectText(x),
        formatMessageSender(x.recipient),
        x.created
      ];
    });
  
  }

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

  HTTPRequest(API_URL, function(json) {

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

  });

}

App.prototype.extractURI = function(href) {

  /* Function App.extractURI
   * Extracts the URI from the location
   */

  // Extract the resource URI
  this.uri = new URL(href);

  console.debug("Initializing application at " + this.uri.pathname + ".");

  // Generate the breadcrumbs from the URI
  Element("breadcrumb-container").innerHTML = generateBreadcrumb(this.uri.pathname);

}

App.prototype.init = function() {

  /* function init
   * Initializes the application
   */

  this._initialized = new Date();

  console.debug("Initializing application on " + this._initialized.toISOString());

  // Asynchronously load the network DOI
  this.getNetworkDOI();

  // Extract the resource URI
  this.extractURI(window.location.href);

  // Get new notifications
  this.setupNotificationPolling();

  // Launch the required part of the application
  switch(this.uri.pathname) {
    case "/home/messages/details":
      return this.launchMessageDetails();
    case "/home/messages/new":
      return this.launchNewMessage();
    case "/home/messages":
      return this.launchMessages();
    case "/home/station":
      return this.launchStation();
    case "/home/admin":
      return this.launchAdmin();
    case "/home":
     return this.launchHome();
  }

}

App.prototype.launchAdmin = function() {

  /*
   * Function App.launchAdmin
   * Launches some client-side code for the admin console
   */

  const SERVICES = [{
    "name": "station",
    "url": CONFIG.FDSNWS.STATION.HOST.replace("query", "version")
  }, {
    "name": "dataselect",
    "url": CONFIG.FDSNWS.DATASELECT.HOST.replace("query", "version")
  }, {
    "name": "wfcatalog",
    "url": CONFIG.FDSNWS.WFCATALOG.HOST.replace("query", "version")
  }, {
    "name": "routing",
    "url": CONFIG.FDSNWS.ROUTING.HOST.replace("query", "version")
  }];

  const S_UPDATE_SEISCOMP = "The SeisComP3 database has been updated.";
  const S_RESTART_FDSNWS = "SeisComP3 FDSNWS Station has been restarted.";
  const S_UPDATE_PROTOTYPES = "The network prototypes have been updated.";
  const S_ADD_USER = "The new user has been succesfully added.";

  if(location.search) {
    switch(location.search.substring(1)) {
      case "S_UPDATE_SEISCOMP":
        Element("modal-content").innerHTML = generateMessageAlert("success", S_UPDATE_SEISCOMP); break;
      case "S_UPDATE_PROTOTYPES":
        Element("modal-content").innerHTML = generateMessageAlert("success", S_UPDATE_PROTOTYPES); break;
      case "S_ADD_USER":
        Element("modal-content").innerHTML = generateMessageAlert("success", S_ADD_USER); break;
      case "S_RESTART_FDSNWS":
        Element("modal-content").innerHTML = generateMessageAlert("success", S_RESTART_FDSNWS); break;
    }
    $("#modal-alert").modal();
  }

  SERVICES.forEach(function(service) {

    // Time the request
    var start = Date.now();

    HTTPRequest(service.url, function(json) {

      if(json === null) {
        Element("card-" + service.name).className = "card text-white bg-danger";
        Element("card-" + service.name + "-text").innerHTML = "Could not get version";
      } else {
        Element("card-" + service.name).className = "card text-white bg-success";
        Element("card-" + service.name + "-text").innerHTML = "version " + json + " - " + (Date.now() - start) + "<small>ms</small>";
      }

    });

  });

  // Create a table for registered users & prototypes
  createUserTable();
  createPrototypeTable();

  // Set the last breadcrum title
  updateCrumbTitle("Administrator Panel");

}

function createPrototypeTable() {

  function formatPrototypeTable(x) {

    /*
     * Function formatPrototypeTable
     * Sorts documents by the created property
     */

    return [
      "<a target='_blank' href='/api/prototype?id=" + x.sha256 + "'><code data-toggle='tooltip' data-placement='right' data-html='true' title='<span class=\"fas fa-fingerprint\"></span> " + x.sha256 +"'>" + x.sha256.slice(0, 8) + "…</code></a>",
      x.network.code,
      x.network.start ? new Date(x.network.start).getFullYear() : "",
      x.end ? new Date(x.end).getFullYear() : "",
      "<small>" + x.description + "</small>",
      x.restricted,
      x.created
    ];

  }

  // Collect all network prototypes from the API
  HTTPRequest("/api/prototypes", function(json) {

    if(json === null) {
      return Element("prototype-table").innerHTML = "<span class='text-muted'>No prototypes available.</span>";
    }

    json.sort(sortCreated).map(getPrototypeValues).filter(unique).forEach(addPrototypeSelection);

    new Table({
      "id": "prototype-table",
      "search": true,
      "header": new Array("Identifier", "Code", "Start", "End", "Description", "Restricted", "Created"),
      "body": json.sort(sortCreated).map(formatPrototypeTable)
    });

  });

}

function getPrototypeValues(x) {

  /*
   * Function getPrototypeValues
   * Adds a prototype to the user prototype selection box
   */

  return x.network.code + " " + x.network.start;

}

function addPrototypeSelection(x) {

  /*
   * Function addPrototypeSelection
   * Adds a prototype to the user prototype selection box
   */

  var option = document.createElement("option");

  option.text = x.split("-")[0];
  option.value = x;

  Element("prototype-select").add(option);

}

function sortCreated(x, y) {

  /* function sortCreated
   * Sorts documents by the created property
   */

  return (new Date(y.created) - new Date(x.created));

}

function createUserTable() {

  /*
   * Function createUserTable
   * Makes API call and creates the user table 
   */

  function formatUserTable(x) {

    /*
     * Function formatUserTable
     * Generator for a single row of the user table
     */

    return [
      formatMessageSender(x),
      x.role === 0 ? "Administrator" : "Network Operator",
      x.role === 0 ? "" : (x.network.code + " " + new Date(Date.parse(x.network.start)).getFullYear()),
      x.created
    ];

  }

  // Asynchronous request to get the users API
  HTTPRequest("/api/users", function(json) {

    if(json === null) {
      return Element("user-table").innerHTML = "<span class='text-muted'>No users available.</span>";
    }

    new Table({
      "id": "user-table",
      "search": true,
      "header": new Array("Username", "Role", "Network Prototype", "Created"),
      "body": json.sort(sortCreated).map(formatUserTable)
    });

  });

}

function getStatus(status) {

  /* Function App.setupStagedFilePolling::createStagedMetadataTable::getStatus
   * Maps status integer to string
   */

  const METADATA_STATUS_SUPERSEDED = -3;
  const METADATA_STATUS_DELETED = -2;
  const METADATA_STATUS_REJECTED = -1;
  const METADATA_STATUS_UNCHANGED = 0;
  const METADATA_STATUS_PENDING = 1;
  const METADATA_STATUS_VALIDATED = 2;
  const METADATA_STATUS_CONVERTED = 3;
  const METADATA_STATUS_APPROVED = 4;
  const METADATA_STATUS_AVAILABLE = 5;

  switch(status) {
    case METADATA_STATUS_SUPERSEDED:
      return "<span title='Metadata is superseded or expired' class='text-muted'>" + getIcon("ban") + " Superseded </span>"
    case METADATA_STATUS_REJECTED:
      return "<span class='text-danger'>" + getIcon("times") + " Rejected </span>"
    case METADATA_STATUS_PENDING:
      return "<span title='Metadata is awaiting validation' class='text-warning'>" + getIcon("clock") + " Pending </span>"
    case METADATA_STATUS_VALIDATED:
      return "<span title='Metadata is semantically validated' class='text-info'>" + getIcon("cogs") + " Validated </span>"
    case METADATA_STATUS_CONVERTED:
      return "<span title='Metadata is converted to SC3ML' class='text-info'>" + getIcon("cogs") + " Converted </span>"
    case METADATA_STATUS_APPROVED:
      return "<span title='Metadata is approved by the system' class='text-success'>" + getIcon("check") + " Approved </span>"
    case METADATA_STATUS_AVAILABLE:
      return "<span title='Metadata is available through FDSNWS' class='text-success'>" + getIcon("rocket") + " Available </span>"
    case METADATA_STATUS_DELETED:
      return "<span title='Metadata processing is terminated' class='text-danger'>" + getIcon("ban") + " Terminated </span>"
    default:
      return "<span title='Metadata has an unknown status' class='text-muted'>" + getIcon("question") + " Unknown </span>"
  }

}

App.prototype.setupStagedFilePolling = function() {

  /* Function App.setupStagedFilePolling
   * Sets up long polling for submitted metadata files
   */

  function createStagedMetadataTable(json) {
  
    /* Function App.setupStagedFilePolling::createStagedMetadataTable
     * Create the staged metadata table
     */

    const HTML_TABLE_ID = "table-staged-metadata";
  
    // Sort by the created timestamp
    json.sort(function(a, b) {
      return Date.parse(b.created) - Date.parse(a.created);
    });
  
    // Set up the body for the table
    var stagedTable = json.map(function(file) {

      var title = file.status === -1 ? file.error : "";
      var statusInformation = "<b title='" + title + "'>" + getStatus(file.status) + "</b>";

      return [
        "<b><a href='/home/station?network=" + file.network.code + "&station=" + file.station + "'>" + file.network.code + "." + file.station +" </a></b>" + (file.new ? "&nbsp;<span class='fa fa-star text-warning'></span>" : ""),
        "<a target='_blank' href='/api/history?id=" + file.sha256 + "'><code data-toggle='tooltip' data-placement='right' data-html='true' title='<span class=\"fas fa-fingerprint\"></span> " + file.sha256 +"'>" + file.sha256.slice(0, 8) + "…</code></a>",
        file.nChannels,
        file.created,
        file.modified || file.created,
        (1E-3 * file.size).toFixed(1) + "KB",
        statusInformation
      ];
    });
  
    Element("table-staged-legend").style.display = 'inline-block';
  
    const STAGED_METADATA_TABLE_HEADER = [
      "Station",
      "Identifier",
      "Number of Channels",
      "Submitted",
      "Modified",
      "Inventory Size",
      "Status"
    ];
  
    new Table({
      "id": HTML_TABLE_ID,
      "header": STAGED_METADATA_TABLE_HEADER,
      "body": stagedTable,
      "search": true
    });
  
  }

  // Polling interval
  const STAGED_POLL_MS = 60000;

  HTTPRequest("/api/staged", createStagedMetadataTable);

  setTimeout(this.queryStaged, STAGED_POLL_MS);

}

App.prototype.statistics = function() {

  /*
   * Function App.statistics
   * Creates the statistics chart
   */

  function getSubtitle(network) {

    if(network === "*") {
      return "All networks";
    } else {
      return "Network <b>" + network + "</b>";
    }

  }

  // Fake data for display
  var data = new Array();

  for(var i = 0; i < 52; i++) {

    endDate = new Date();

    data.push({
      "x": endDate.setDate(endDate.getDate() + (7 * i)),
      "y": 0.3333 * (Math.sin(0.5 * i * Math.PI) + Math.sin(0.25 * i * Math.PI) + Math.sin(0.1 * i * Math.PI)) + 1
    });

  }

  var subtitle = getSubtitle(USER_NETWORK.network.code);

  Highcharts.chart("statistics-chart-bar", {
    "chart": {
      "type": "column"
    },
    "title": {
      "text": "Continuous Waveform Data Exported"
    },
    "subtitle": {
      "text": subtitle
    },
    "xAxis": {
      "type": "datetime"
    },
    "yAxis": {
      "min": 0,
      "title": {
        "text": "Number of bytes exported"
      }
    },
    "plotOptions": {
      "column": {
        "pointPadding": 0,
        "borderWidth": 1,
        "groupPadding": 0
      }
    },
    "credits": {
      "enabled": false
    },
    "series": [{
      "name": "Bytes exported",
      "data": data
    }]
  });

  // Build the chart
  Highcharts.chart("statistics-chart-pie", {
    "chart": {
      "type": "pie"
    },
    "title": {
      "text": "Type of Waveform Data Exported"
    },
    "plotOptions": {
      "pie": {
        "showInLegend": true
      }
    },
    "credits": {
      "enabled": false
    },
    "series": [{
      "name": "Brands",
      "colorByPoint": true,
      "data": [{
        "name": "Accelerometric",
        "y": 61.41,
      }, {
        "name": "High Broadband",
        "y": 11.84
      }, {
        "name": "Infrasound",
        "y": 1.82
      }, {
        "name": "Broadband",
        "y": 10.85
      }]
    }]
  });

}

App.prototype.launchHome = function() {

  /*
   * Function App.launchHome
   * Launches part of the application dealing with the homepage
   */

  function mapInformationString(nStations) {
  
    /*
     * Function App.launchHome::mapInformationString 
     * Returns formatted information string below map
     */
  
    if(USER_NETWORK.network.code === "*") {
      return "<small>Map showing <b>" + nStations + "</b> stations available from ORFEUS Data Center.<b>"; 
    }

    return "<small>Map showing <b>" + nStations + "</b> stations available from network <b>" + USER_NETWORK.network.code + "</b> as available from FDSNWS.</small>";
  
  }

  // Send notification depending on query from the URL
  const S_METADATA_SUCCESS = "The metadata has been succesfully received.";
  const S_SEEDLINK_SERVER_SUCCESS = "The Seedlink server has been succesfully added.";
  const E_METADATA_ERROR = "There was an error receiving the metadata.";
  const E_INTERNAL_SERVER_ERROR = "The server experienced an internal error.";
  const E_SEEDLINK_SERVER_EXISTS = "The submitted Seedlink server already exists.";
  const E_SEEDLINK_HOST_INVALID = "The Seedlink host is invalid.";
  const E_SEEDLINK_PORT_INVALID = "The Seedlink port is invalid.";
  const E_UNKNOWN_ERROR = "The server experienced an unknown error.";

  // Some error messages
  if(this.uri.search && this.uri.search !== "?welcome") {
    switch(this.uri.search.substring(1)) {
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
  this.AddMap();

  // Polling for metadata files that are staged
  this.setupStagedFilePolling();

  // Adds possibility to upload metadata
  if(USER_NETWORK.network.code !== '*') {
    this.AddMetadataUpload();
  }

  var start = Date.now();

  this.statistics();

  // Add the stations to the map
  HTTPRequest("/api/stations", function(json) {

    if(json === null) {
      json = new Array();
    }

    console.debug("Retrieved " + json.length + " stations from server in " + (Date.now() - start) + "ms.");

    // Cache
    _stationJson = json;

    var markers = new Array();
    var bounds = new google.maps.LatLngBounds();

    // For each entry create a station marker
    json.forEach(function(station) {

      bounds.extend(station.position);

      var marker = new google.maps.Marker({
        "map": this.map,
        "icon": getOperationalStationMarker(station),
        "title": station.network + "." + station.station,
        "description": station.description,
        "station": station.station,
        "start": station.start,
        "end": station.end,
        "network": station.network,
        "position": station.position,
      });

      var _this = this;

      // Event listener for clicks
      marker.addListener("click", function() {

        var position = this.getPosition();

        var boreholes = markers.filter(function(x) {
          return x.getPosition().equals(position);
        });

        _this.infowindow.close();

        if(boreholes.length === 1) {
          _this.infowindow.setContent(GoogleMapsInfoWindowContent(this));
        } else {
          _this.infowindow.setContent(GoogleMapsInfoWindowContentBorehole(boreholes));
        }

        _this.infowindow.open(this.map, marker);

      });

      // Make sure to keep a reference
      markers.push(marker);

    }.bind(this));

    // Fit map bounds around all markers
    this.map.fitBounds(bounds);

    // Update metadata
    Element("map-information").innerHTML = mapInformationString(json.length);

    // Bind the markers to the change event
    Element("map-display").addEventListener("change", changeMapLegend.bind(this, markers));
    changeMapLegend(markers);

    // Proceed with generation of the table
    this.generateStationTable();

  }.bind(this));

}

App.prototype.launchStation = function() {

  /* Function App.launchStation
   * Launches code for station details
   */

  const MAP_STATION_ZOOM_LEVEL = 12;

  // Add the map
  this.AddMap();

  // Set the zoom level for the individual station
  this.map.setZoom(MAP_STATION_ZOOM_LEVEL);

  Element("history-table-title").innerHTML = this.queryString.network + "." + this.queryString.station;

  function formatHistoryTable(x) {

    var title = x.status === -1 ? x.error : "";
 
    return [
        "<a target='_blank' href='/api/history?id=" + x.sha256 + "'><code data-toggle='tooltip' data-placement='right' data-html='true' title='<span class=\"fas fa-fingerprint\"></span> " + x.sha256 +"'>" + x.sha256.slice(0, 8) + "…</code></a>",
      x.created,
      x.type,
      x.nChannels,
      (1E-3 * x.size).toFixed(1) + "KB",
      "<b title='" + title + "'>" + getStatus(x.status) + "</b>"
    ];

  }

  HTTPRequest("/api/history?network=" + this.queryString.network + "&station=" + this.queryString.station, function(json) {
  
    if(json === null) {
      return Element("metadata-history").innerHTML = "<span class='text-muted'>No metadata history is available.</span>";
    }

    // Sort by ascending date
    json.sort((a, b) => Date.parse(b.created) - Date.parse(a.created));

    new Table({
      "id": "metadata-history",
      "header": ["Identifier", "Submitted", "Metadata Type", "Number of Channels", "Inventory Size", "Status"],
      "body": json.map(formatHistoryTable),
      "search": false
    });

    var topElement = json[0];

    // Add option to supersede the most recent metadata
    switch(topElement.status) {
      case 5:
        return Element("metadata-history").innerHTML += "<button class='btn btn-danger btn-sm' onclick='deleteMetadata(\"" + topElement.sha256 + "\")'>Supersede Metadata</button>";
      case -2:
      case -3:
        return;
      default:
        return Element("metadata-history").innerHTML += "<button class='btn btn-danger btn-sm' onclick='deleteMetadata(\"" + topElement.sha256 + "\")'>Terminate Processing</button>";
    }

  });

  var exampleSocket;
  var queryStringPointer = this.queryString;

  // Change event to toggle WS connection
  Element("connect-seedlink").addEventListener("change", function() {

    // Close the socket
    if(!this.checked) {
      return exampleSocket.close();
    }

    // Open a new socket
    exampleSocket = new WebSocket(SOCKET_URL);

    // Even when connection is made
    exampleSocket.onopen = function(event) {
      exampleSocket.send(JSON.stringify({"subscribe": queryStringPointer.network + "." + queryStringPointer.station}));
    }

    // When a record is received from Seedlink
    exampleSocket.onmessage = function(event) {

      var data = JSON.parse(event.data);

      // Ignore success and error commands
      if(data.success || data.error) {
        return console.debug(data);
      }

      // Update the realtime waveforms
      if(!chartPointers.hasOwnProperty(data.id)) {
        chartPointers[data.id] = new SeedlinkChannel(data);
      } else {
        chartPointers[data.id].Update(data);
      }

    }

  });

  this.getStationDetails();

}

App.prototype.getStationDetails = function() {

  /* App.getStationDetails
   * Updates content with detailed station information
   */

  HTTPRequest("/api/channels" + window.location.search, function(json) {

    Element("channel-information-header").innerHTML = getIcon("signal", "muted") + " " + this.queryString.network + "." + this.queryString.station;

    if(json === null) {
      Element("channel-information").innerHTML = "<span class='text-muted'>Station information is unavailable from FDSNWS.</span>";
      return this.map.setCenter({"lat": 52.10165, "lng": 5.1783});
    }

    // Cache
    _channelJson = json;

    // Proceed getting latency information
    this.getStationLatencies();

    // Generate the channel list accordion
    Element("channel-information").innerHTML = generateAccordion(_channelJson);

    // When a change is requested, regenerate the accordion
    Element("hide-channels").addEventListener("change", function() {
      Element("channel-information").innerHTML = generateAccordion(_channelJson);
    });

    var station = json[0];

    // Add a single marker for the station
    var marker = new google.maps.Marker({
      "map": this.map,
      "icon": isStationActive(station) ? STATION_MARKER_GREEN : STATION_MARKER_ORANGE,
      "title": [station.network, station.station].join("."),
      "position": station.position
    });

    // Update the final crumb with the station name
    updateCrumbTitle(marker.title);

    Element("map-information").innerHTML = "Map showing station <b>" + marker.title + "</b> with <b>" + json.filter(isStationActive).length + "</b> open channels.";

    // Event listener for clicks
    marker.addListener("click", function() {
      this.infowindow.close();
      this.infowindow.setContent("Station <b>" + marker.title + "</b>")
      this.infowindow.open(this.map, marker);
    }.bind(this));

    // Focus on the station
    this.map.setCenter(station.position);

  }.bind(this));

}


App.prototype.launchNewMessage = function() {

  /* Function App.launchNewMessage
   * Launches the code to be executed when composing a new message
   */

  function getMessageAlert(search) {

    const S_MESSAGE_SENT = "Private message has been succesfully sent.";
    const E_MESSAGE_RECIPIENT_NOT_FOUND = "Recipient could not be found.";
    const E_MESSAGE_SERVER_ERROR = "Private message could not be sent. Please try again later.";
    const E_MESSAGE_SELF = "Cannot send private message to yourself.";

    switch(search) { 
      case "?self":
        return generateMessageAlert("warning", E_MESSAGE_SELF);
      case "?unknown":
        return generateMessageAlert("warning", E_MESSAGE_RECIPIENT_NOT_FOUND);
      case "?success":
        return generateMessageAlert("success", S_MESSAGE_SENT);
      case "?failure":
        return generateMessageAlert("danger", E_MESSAGE_SERVER_ERROR);
      default:
        return "";
    }

  }

  // Overwrite the final crumb
  updateCrumbTitle("Create New Message");

  // Set the message box
  Element("message-information").innerHTML = getMessageAlert(this.uri.search);

}

function getOperationalStationMarker(marker) {

  /* function getOperationalStationMarker
   * Returns marker for open (GREEN) & closed (RED) station
   */

  return isStationActive(marker) ? STATION_MARKER_GREEN : STATION_MARKER_RED;

}

function changeMapLegend(markers) {

  /* function changeMapLegend
   * Changes the HTML of the map legend
   */

  function getDeploymentStationMarker(marker) {
  
    /* function getDeploymentStationMarker
     * Returns marker for permanent (GREEN) & temporary (RED) station
     */
  
    function isStationPermanent(station) {
    
      /* Function isStationPermanent
       * Returns true if a station is permanently deployed
       */
    
      return isNaN(Date.parse(station.end));
    
    }

    return isStationPermanent(marker) ? STATION_MARKER_GREEN : STATION_MARKER_RED;
  
  }

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
    {"icon": STATION_MARKER_GREY, "description": "Unknown"}
  ];

  const MAP_LEGEND_OPERATIONAL = [
    {"icon": STATION_MARKER_GREEN, "description": "Operational"},
    {"icon": STATION_MARKER_RED, "description": "Closed"}
  ];

  const MAP_LEGEND_DEPLOYMENT = [
    {"icon": STATION_MARKER_GREEN, "description": "Permanent"},
    {"icon": STATION_MARKER_RED, "description": "Temporary"}
  ];

  const mapLegend = Element("map-legend");

  // What element to display
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

App.prototype.addSeedlink = function() {

  /* Function App.addSeedlink
   * Queries for registered Seedlink servers
   */

  const SEEDLINK_TABLE_HEADER = [
    "",
    "Address",
    "Port",
    "Institution",
    "Version",
    "Stations",
  ];

  // Query the seedlink server API
  HTTPRequest("/api/seedlink", function(json) {

    if(json === null) {
      return;
    }

    var tableContent = json.map(function(x) {

      // Host metadata 
      var icon = " &nbsp; " + (x.connected ? getIcon("check", "success") : getIcon("times", "danger"));
      var host = "<span title='" + x.ip + "'>" + x.host + "</span>";
      var port = x.port;

      // Seedlink server metadata
      var version = x.version ? x.version.split("::").pop() : "Unknown";
      var identifier = x.identifier || "Unknown";

      // Could not connect to the remote Seedlink server
      if(!x.connected) {
        return [icon, host, port, identifier, version, "<small>Seedlink Server is unreachable</small>"];
      }
 
      if(x.stations === null) {
        return [icon, host, port, identifier, version, "<small> CAT not available </small>"]; 
      }

      // No stations were returned
      if(x.stations.length === 0) {
        return [icon, host, port, identifier, version, "<small> No stations for network " + USER_NETWORK.code + "</small>"];
      }

      var stations = x.stations.map(function(x) {
        if(_latencyHashMap.hasOwnProperty(x.network + "." + x.station)) {
          return "<small><a href='/home/station?network=" + x.network + "&station=" + x.station + "'><span class='text-success'>" + x.network + "." + x.station + "</span></a></small>";
        } else {
          return "<small><a href='/home/station?network=" + x.network + "&station=" + x.station + "'><span class='text-muted'>" + x.network + "." + x.station + "</span></a></small>";
        }
      }).join(" ");

      // Return a row for the table
      return [icon, host, port, identifier, version, stations];

    });

    new Table({
      "id": "seedlink-connection-table",
      "header": SEEDLINK_TABLE_HEADER,
      "body": tableContent,
      "search": false
    });

  });

}

function Element(id) {

  /* function Element
   * Returns the DOM element with particular ID
   */

  return document.getElementById(id);

}

function updateCrumbTitle(subject) {

  /* function updateCrumbTitle
   * Updates the final breadcumb with a new subject
   */

  Element("final-crumb").innerHTML = subject;

}

function deleteMetadata(hash) {

  // Make sure this is not a mistake
  if(!confirm("Are you sure you want to supersede the metadata?")) {
    return;
  }

  console.debug("Superseding document with identifier " + hash);

  // Instead of "GET" we pass "DELETE" to the HTTP API with the same message identifier
  $.ajax({
    "url": "/api/history?id=" + hash,
    "type": "DELETE",
    "dataType": "JSON",
    "success": function() {
      window.location.reload();
    }
  });

}

function deleteAllMessages(type) {

  /* Function deleteAllMessages
   * Deletes all the users' messages
   */

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
    throw("Could not delete all messages.");
  }

  // Instead of "read" we pass "delete" to the API with the same message identifier
  $.ajax({
    "url": "/api/messages?" + search,
    "type": "DELETE",
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
   *
   * Returns specific formatting for particular senders (e.g. administrator)
   *
   */

  // Indicate user is an administrator
  if(sender.role === 0) {
    return sender.username + " (<span class='text-danger'><b>O</span>RFEUS Administrator</b>)";
  }
 
  return sender.username;

}

function getIcon(icon, color) {

  /* Function getIcon
   * Returns font-awesome icon with a particular color
   */

  return "<span class='fas fa fa-" + icon + " text-" + color + "'></span>";

}

function GoogleMapsInfoWindowContentBorehole(markers) {

  var arrowIcon = getIcon("arrow-down", "muted");

  return [
    "<div style='text-align: center;'>",
    "  <h4> " + getIcon("ruler-vertical", "primary") + " Vertical Array </h4>",
    "  <span class='text-muted'>" + arrowIcon + " Scroll for More " + arrowIcon + "</span>",
    "</div>",
    "<hr>",
    markers.map(GoogleMapsInfoWindowContent).join("<hr>")
  ].join("");

}

function GoogleMapsInfoWindowContent(marker) {

  /*
   * Function GoogleMapsInfoWindowContent
   * Returns content string for Google Maps info window
   */

  function markerDetailLink(marker) {

    /*
     * Function markerDetailLink
     * Returns formatted HTML link to station detail page
     */

    return "<a href='/home/station?network=" + marker.network + "&station=" + marker.station + "'>" + getIcon("cogs") + " <b>View Instrument Details</b></a>";

  }

  var latencyInformation = "<i> Latencies not available </i>";
  if(_latencyHashMap.hasOwnProperty(marker.title)) {
    latencyInformation = createLatencyTrafficLight(_latencyHashMap, marker);
  }

  return [
    "<h5> " + getIcon("database", "primary") + " Station " + marker.title + "</h5>",
    "<hr>",
    "<p><i>" + marker.description + "</i>",
    "<br>",
    "<br>",
    "Operational from <b>" + marker.start + "</b> - <b>" + (marker.end || "present") + "</b>",
    "<br>",
    "At location <b>" + marker.position.lat().toFixed(3) + "</b>°N, <b>" + marker.position.lng().toFixed(3) + "</b>°E",
    "<br>",
    "<div style='text-align: center;'>",
    latencyInformation,
    "<br>",
    "<br>",
    markerDetailLink(marker),
    "</div>",
    "<br>"
  ].join(""); 

}

App.prototype.getNetworkDOI = function() {

  /* Function getNetworkDOI
   * Queries the ORFEUS DOI API for information
   * on the network digital identifier
   */

  function getDOI(network, callback) {
  
    /* Function getDOI
     * Queries ORFEUS API for DOI information beloning to network
     */
  
    HTTPRequest(DOI_URL + "?network=" + network, callback);

  }

  function getFormattedDOILink(element, network) {

    /*
     * Function getFormattedDOILink
     * Returns formatted DOI link to show on page
     */

    return "<a title='" + element.doi + "' href='https://doi.org/" + element.doi + "'><span class='fas fa-globe-americas'></span> " + network.description + " (" + network.network.code + ")</a>";

  }

  var doiElement = Element("doi-link");

  // Do not show all DOIs for an administrator
  if(this.network.network.code === "*") {
    return doiElement.innerHTML = "<small><a href='/home/admin'><i class='fas fa-unlock-alt'></i> Administrator Panel</a></small>";
  }

  // Asynchronous call to get the DOI
  getDOI(this.network.network.code, function(json) {

    // When nothing returned just put the network
    if(json === null) {
       return doiElement.innerHTML = "<span class='fas fa-globe-americas'></span> " + this.network.description + " <a href='https://www.fdsn.org/services/doi/'><small title='A digital object identifier allows users to acknowledge data from your network'>Request a DOI!</small></a>";
    }

    var element = json.pop();

    console.debug("DOI returned from FDSN: " + element.doi);

    // Update the DOM to reflect the DOI
    doiElement.innerHTML = getFormattedDOILink(element, this.network);

    // Continue with the actual DOI lookup
    if(false) {
      doiLookup(element.doi, function(jsonld) {
        // noop
      });
    }

  }.bind(this));

}

function doiLookup(doi, callback) {

  /* Function doiLookup
   * Looks up DOI from a registration and returns json+ld
   * of metadata in callback
   */

  const DOI_REGISTRATION_URL = "https://doi.org/";

  $.ajax({
    "url": DOI_REGISTRATION_URL + doi,
    "method": "GET",
    "headers": {
      "Accept": "application/vnd.schemaorg.ld+json"
    },
    "success": callback
  });
  
}

function getLatencyColorClass(channel, latency) {

  /* getLatencyColorClass
   * Returns the color that belongs to the particular latency value
   */

  const COLOR_CODES = [
    "muted",
    "success",
    "info",
    "warning",
    "danger"
  ];

  // Number of seconds for a record to fill
  return COLOR_CODES[getLatencyStatus(channel, latency)];

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
  if(_latencyHashMap.hasOwnProperty(stationIdentifier)) {

    // Get the average of all channel statuses
    var average = getAverage(Object.keys(_latencyHashMap[stationIdentifier]).map(function(channel) {

      return getAverage(_latencyHashMap[stationIdentifier][channel].map(function(x) {
        return getLatencyStatus(channel, x.msLatency);
      }));

    }));

    return STATION_MARKERS[Math.round(average)];

  }

  // No information
  return STATION_MARKER_GREY;

}

function getLatencyStatus(channel, latency) {

  /* Function getLatencyStatus
   *
   * returns the grade of latency status
   * dependent on channel type:
   *
   *   0 UNKNOWN
   *   1 GREEN
   *   2 ORANGE
   *   3 RED
   */

  function _compare(latency, rate) {

    /* Private Function _compare
     *
     * Compares the latency in miliseconds
     * to the expected rate
     */

    const GREEN = 1;
    const ORANGE  = 2;
    const RED = 3;

    return (latency / rate) < 1 ? GREEN : RED;

  }

  const UNKNOWN = 0;

  // Limits
  const VLOW_RATE = 1E7;
  const LOW_RATE = 1E6;
  const BROAD_RATE = 2.5E4;
  const HIGH_RATE = 1E4;

  // Map first channel code to a particular rate and color
  switch(channel.charAt(0)) {
    case "V":
      return _compare(latency, VLOW_RATE);
    case "L":
      return _compare(latency, LOW_RATE);
    case "B":
      return _compare(latency, BROAD_RATE);
    case "H":
      return _compare(latency, HIGH_RATE);
    default:
      return UNKNOWN;
  }

}

String.prototype.capitalize = function() {

  /* Function String.capitalize
   * Capitalizes the first letter of a string
   */

  return this.charAt(0).toUpperCase() + this.slice(1);

}

function generateBreadcrumb(pathname) {

  /* Function generateBreadcrumb
   * Renders the HTML for a single breadcrumb element
   */

  var crumbs = pathname.split("/").slice(1);

  // Homepage, no breadcrumbs
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

     // Extend with the current path
     fullCrumb = fullCrumb +  "/" + x;

     // Capitalize the first letter of the path
     x = x.capitalize();

     // Add a home icon to the first element
     if(i === 0) {
       x = getIcon("home") + " " + x;
     }

     // Add the active class to the final crumb
     if(i === (crumbs.length - 1)) {
       return "<li id='final-crumb' class='breadcrumb-item active'>" + x + "</li>";
     } else {
       return "<li class='breadcrumb-item'><a href='" + fullCrumb + "'>" + x + "</a></li>";
     }

  }).join("\n");

}


console.debug = (function(fnClosure) {

  /* Function console.debug
   * Monkey patch the debug function to
   * only log when a variable is set
   */

  return function(msg) {
    if(__DEBUG__) {
      fnClosure(msg);
    }
  }

})(console.debug);

function createLatencyTrafficLight(hashMap, x) {

  /*
   * Function createLatencyTrafficLight
   * Returns traffic light color of latency status
   */

  function getAverageLatencyLight(code, x) {

    /*
     * Function getAverageLatencyLight
     * Returns the average latency for a group of channels with the same code
     */

    function channelCodeToDescription(code, average) {

      /*
       * Function channelCodeToDescription
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
          return "Unknown Channel Type (" + average + ")";
      }

    }

    // Get the average latency for this particular channel
    var average = getAverage(x.map(y => y.msLatency));

    // Generate HTML
    return [
      "<span title='" + channelCodeToDescription(code, average) + "' class='fa fa-exclamation-circle text-" + getLatencyColorClass(code, average) + "'>",
        "<span style='font-family: monospace;'><b>" + code + "</b></span>",
      "</span>",
    ].join("\n");

  }

  var stationIdentifier = [x.network, x.station].join(".");

  // If the station exists loop over all grouped channels
  if(hashMap.hasOwnProperty(stationIdentifier)) {
    return Object.keys(hashMap[stationIdentifier]).map(function(channel) {
      return getAverageLatencyLight(channel, hashMap[stationIdentifier][channel]);
    }).join("\n");
  }

  // There is no information
  return getIcon("circle", "muted");

}

App.prototype.generateStationTable = function() {

  /* function GenerateTable
   * Generates the station latency table to be shown
   */

  function generateStationLatencyTable(latencies) {
  
    /* Function generateStationLatencyTable
     * Combines latency and station information to single rows
     */
  
    function createLatencyHashmap(latencies) {
    
      /* Function createLatencyHashmap
       * Creates a hashmap of all station latencies
       * ordered by station code
       */
    
      var channelIdentifier;
    
      var start = Date.now();
    
      var hashMap = new Object();
    
      // Go over the array
      latencies.forEach(function(x) {
    
        // This will be the key in the hash map
        var identifier = x.network + "." + x.station;
    
        // If it doesn't exist in the hashmap create a new object
        if(!hashMap.hasOwnProperty(identifier)) {
          hashMap[identifier] = new Object();
        }
    
        // Get the first letter from the channel
        channelIdentifier = x.channel.charAt(0);
    
        // Group latencies by the initial letter
        if(!hashMap[identifier].hasOwnProperty(channelIdentifier)) {
          hashMap[identifier][channelIdentifier] = new Array();
        }
    
        // Add the particular latency
        hashMap[identifier][channelIdentifier].push({
          "msLatency": x.msLatency,
          "channel": x.channel
        });
    
      });
    
      console.debug("Latency hashmap generated in " + (Date.now() - start) + " ms.");
    
      return hashMap;
    
    }

    function createTableBody(x) {

      return [
        "&nbsp; " + createLatencyTrafficLight(_latencyHashMap, x),
        x.network,
        x.station,
        x.description,
        x.position.lat,
        x.position.lng,
        x.elevation,
        isActive(x),
        "<a href='./home/station?network=" + x.network + "&station=" + x.station + "'>View</a>"
      ];

    }

    function makeStationTable() {
    
      /* Function makeStationTable
       * Creates a table
       */
    
      const TABLE_HEADER = [
        "Status",
        "Network",
        "Station",
        "Description",
        "Latitude",
        "Longitude",
        "Elevation",
        "Operational",
        "Details"
      ];
    
      // Get the list (filtered)
      new Table({
        "id": "table-container",
        "search": true,
        "header": TABLE_HEADER,
        "body": _stationJson.map(createTableBody)
      });

      if(USER_NETWORK.network.code === "*") {
        Element("table-information").innerHTML = "<small>Table showing <b>" + _stationJson.length + "</b> available from FDSNWS.</small>";
      } else {
        Element("table-information").innerHTML = "<small>Table showing <b>" + _stationJson.length + "</b> stations from network <b>" + USER_NETWORK.network.code + "</b> as available from FDSNWS.</small>";
      }
    
    }

    if(latencies !== null) {
      console.debug("Received " + latencies.length + " channel latencies from server in " + (Date.now() - start) + " ms.");

      // Create a hash map of the latencies for quick look-up
      _latencyHashMap = createLatencyHashmap(latencies);
    }
  
    // Updates the station table
    makeStationTable();


    this.addSeedlink()
  
  }

  var start = Date.now();

  // Asynchronous request to get the latency information
  HTTPRequest("/api/latency?network=" + this.network.network.code, generateStationLatencyTable.bind(this)); 

}

function Sum(array) {

  /* Function Sum
   * returns the average of an array
   */

  return array.reduce(function(a, b) {
    return a + b;
  }, 0);

}


function getAverage(array) {

  /* function getAverage
   * returns the average of an array
   */

  return Sum(array) / array.length;

}

function isStationActive(station) {

  /* function isStationActive
   * Returns true if a station is operational
   */

  var parsedEnd = Date.parse(station.end);

  return isNaN(parsedEnd) || parsedEnd > Date.now();

}

function isActive(station) {

  /* Function isActive
   * Returns icon for closed or open station
   */

  // Station is open
  if(isStationActive(station)) {
    return getIcon("check", "success"); 
  }

  // Station is closed
  return getIcon("times", "danger");

}

function getInstrumentResponse(query) {

  /* Function getInstrumentResponse
   * Queries the ORFEUS API for the instrument response of a particular channel
   */

  function mapUnit(unit) {
  
    /* function mapUnit
     * Maps unit shorthand to long description for API call
     */

    switch(unit) {
      case "M":
        return "displacement";
      case "M/S":
        return "velocity";
      case "M/S**2":
        return "acceleration";
      default:
        return "velocity";
    }
  
  }

  // Extract the parameters
  var network = query.split(".")[0];
  var station = query.split(".")[1];
  var loc = query.split(".")[2] || "--";
  var channel = query.split(".")[3];
  var units = query.split(".")[4];

  var queryString = [
    "network=" + network,
    "station=" + station,
    "location=" + loc,
    "channel=" + channel
  ].join("&");

  var API = "http://0.0.0.0:7000?" + queryString

  Element("response-loading-bar").style.display = "block";

  HTTPRequest(API, function(json) {

    // Create the charts
    responseAmplitudeChart(json);
    responsePhaseChart(json);

    // Hide the loading bar
    Element("response-loading-bar").style.display = "none";
    Element("response-charts").style.display = "block";

  });

}

function responsePhaseChart(result) {

  /* FUNCTION responsePhaseChart
   * Creates phase/frequency plot
   */

  if(!result) {
    return Element("response-phase").innerHTML = "Instrument response is unavailable.";
  }

  var series = new Array();
  for(var i = 0; i < result.frequency.length; i++) {
    series.push([result.frequency[i], result.phase[i]]);
  }

  // The Phase response highchart container
  Highcharts.chart("response-phase", {
    "chart": {      
      "height": 200,
      "animation": false,
      "zoomType": "x"
    },
    "title": {
      "text": "" 
    },  
    "subtitle": {
      "text": ''
    },  
    "xAxis": {
      "minorTickInterval": "auto",
      "labels": {
        "style": {
          "fontWeight": "bold",
          "fontSize": "12px"
        }
      },
      "title": { 
        "text": "Frequency (Hz)"
      },
      "type": "logarithmic"
    },
    "yAxis": {
      "title": {
        "text": "Phase (radians)"
      },
      "min": -Math.PI,
      "max": Math.PI,
      "tickPositions": [-Math.PI, -0.5 * Math.PI, 0, 0.5 * Math.PI, Math.PI],
      "labels": {
        "style": {
          "fontWeight": "bold",
          "fontSize": "12px"
        },
        "formatter": function() {
          switch(this.value.toFixed(2)) {
            case "-3.14":
              return "-π";
            case "3.14":
              return "π";
            case "-1.57":
              return "-½π";
            case "1.57":
              return "½π";
            default:
              return 0;
          }
        }
      }
    },
    "tooltip": { 
      "formatter": function() {
        return [
          "<b>" + this.series.name + "</b>",
          "<b>Phase</b>: " + (this.y / Math.PI).toFixed(2) + "π",
          "<b>Frequency</b>: " + this.x.toFixed(2) + "Hz"
        ].join("<br>");
      }
    },
    "legend": {
      "enabled": false
    },
    "credits": {
      "enabled": false
    },
    "plotOptions": {
      "series": {
        "lineWidth": 3,
        "shadow": false
      }
    },
    "series": [{
      "type": "line",
      "name": "Frequency Response",
      "data": series
    }]
  });

}

function responseAmplitudeChart(result) {

  /* FUNCTION responseAmplitudeChart
   * Creates amplitude/frequency plot
   */
 
  if(!result) {
    return Element("response-amplitude").innerHTML = "Instrument response is unavailable.";
  }

  var series = new Array();
  for(var i = 0; i < result.frequency.length; i++) {
    series.push([result.frequency[i], result.amplitude[i]]);
  }

  Highcharts.chart("response-amplitude", {
    "chart": {
      "height": 200,
      "animation": false,
      "zoomType": "x"
    },
    "title": {
      "text": result.channel
    },  
    "subtitle": {
      "text": "Instrument Frequency Response"
    },  
    "xAxis": {
      "minorTickInterval": "auto",
      "visible": true,
      "labels": {
        "enabled": false
      },
      "title": {
        "text": ""
      },
      "type": "logarithmic"
    },  
    "yAxis": {
      "minorTickInterval": "auto",
      "type": "logarithmic",
      "labels": {
        "style": {
          "fontWeight": "bold",
          "fontSize": "12px"
        }
      },
      "title": {
        "text": "Amplitude" 
      }
    },  
    "legend": {
      "enabled": false
    },
    "tooltip": {
      "formatter": function() {
        return [
          "<b>" + this.series.name + "</b>",
          "<b>Amplitude</b>: " + this.y.toFixed(2),
          "<b>Frequency</b>: " + this.x.toFixed(2) + "Hz"
        ].join("<br>");
      }
    }, 
    "plotOptions": {
      "series": {
        "lineWidth": 3,
        "shadow": false 
      },   
    },
    "credits": {
      "enabled": false
    },
    "series": [{
      "type": "line",
      "name": "Frequency Response",
      "data": series
    }]
  });

}

function generateAccordion(list) {

  /* Function generateAccordion
   * Generates a bootstrap accordion
   */

  function generateAccordionContent(list) {
  
    /* Function generateAccordionContent
     * Generates the accordion for a channel component
     */
  
    function generateAccordionContentChannel(channel) {
  
      /* Function generateAccordionContentChannel
       * Generates the content for the channel accordion element
       */
  
      // Table for displaying some channel information
      var tableHTML = [
        "<table class='table table-sm table-striped'>",
        "  <thead>",
        "    <tr><th>Sensor</th><th>Unit</th><th>Sampling Rate</th><th title='Sensor gain factor at " + channel.gainFrequency + "Hz'>Gain</th><th title='Given as azimuth/dip'>Orientation</th></tr>",
        "  </thead>",
        "  <tbody>",
        "    <tr>",
        "      <td>" + channel.description + "</td>",
        "      <td>" + channel.sensorUnits + "</td>",
        "      <td>" + channel.sampleRate + "Hz</td>",
        "      <td>" + channel.gain + "</td>",
        "      <td>" + channel.azimuth + "/" + channel.dip + "</td>",
        "    </tr>",
        "  </tbody>",
        "</table>"
      ].join("\n");
  
      // Build up the query for the FDSNWS-Station channel query
      var query = "?" + [
        "level=response",
        "&net=", channel.network,
        "&sta=", channel.station,
        "&cha=", channel.channel,
        "&loc=", channel.location || "--"
      ].join("");
  
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
        "<button class='btn btn-link' onClick='getInstrumentResponse(\"" + [channel.network, channel.station, channel.location, channel.channel, channel.sensorUnits].join(".") + "\")'>" + getIcon("eye") + " View Sensor Response</button>",
        "<a style='float: right;' class='btn btn-link' target='_blank' href='" + CONFIG.FDSNWS.STATION.HOST + query + "'>" + getIcon("download") + " StationXML</a>",
      ].join("\n");
  
    }
  
    function visibleChannels(channel) {
  
      /* Function visibleChannels
       * Returns whether a station is active and should be visible
       * or show hidden channels is checked
       */
  
      return isStationActive(channel) || Element("hide-channels").checked;
  
    }
  
    // Reset the chart pointers
    chartPointers = new Object();
  
    return list.filter(visibleChannels).map(function(x, i) {
      return [
        "<div class='card'>",
          "<div class='card-header small' role='tab' id='heading-" + i + "'>",
              "<button class='btn btn-link' data-toggle='collapse' data-target='#collapse-" + i + "' aria-expanded='true' aria-controls='collapse-" + i + "'>",
              getIcon("caret-right") + " " + (x.location ? x.location + "." : "") + x.channel,
              "</button>",
              "<span class='heartbeat' id='heartbeat-" + x.location + "-" + x.channel + "'></span>",
              "<span class='text-danger'>" + (isStationActive(x) ? " " : " " + getIcon("lock") + " Channel closed since " + x.end + "</span>"),
          "</div>",
          "<div id='collapse-" + i + "' class='collapse' role='tabpanel' aria-labelledby='heading-" + i + "' data-parent='#accordion'>",
            "<div class='card-body'>",
              generateAccordionContentChannel(x),
            "</div>",
          "</div>",
        "</div>"
      ].join("\n");
    }).join("\n");
  
  }

  return [
    "<div id='accordion'>",
    generateAccordionContent(list),
    "</div>"
  ].join("\n");

}

function downloadAsGeoJSON() {

  /* function downloadAsGeoJSON
   * Exports station information as GeoJSON
   */

  function getFeature(station) {

    /* function downloadAsGeoJSON::getFeature
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

function downloadAsKML() {

  /* function downloadAsKML
   * Opens download for station metata in KML format
   */

  function generateKMLPlacemarks() {
  
    /* function generateKMLPlacemarks
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

  /* function downloadURIComponent
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

  /* Function downloadAsJSON
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

  /* Function downloadAsJSON
   * Generates JSON representation of station table
   */

  const MIME_TYPE = "data:application/json;charset=utf-8";

  var payload = encodeURIComponent(JSON.stringify(_stationJson));

  downloadURIComponent("stations.json", MIME_TYPE + "," + payload);

}

function unique(v, i, a) {
  return a.indexOf(v) === i;
}

App.prototype.AddMetadataUpload = function() {

  /* function AddMetadataUpload
   * Adds event to metadata uploading
   */

  Element("metadata-submission").style.display = "block";
  Element("seedlink-submission").style.display = "block";

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
        return Element("file-help").innerHTML = "<b>" + getIcon("times", "danger") + "</span> " + exception;
      }

      // Allow metadata submission
      Element("file-submit").disabled = false;

      // Generate the content
      var stagedFileContent = stagedStations.map(function(x) {
        return (x.new ? getIcon("star", "warning") + " " : "") + x.network + "." + x.station
      }).filter(unique).join(", ");

      Element("file-help").innerHTML = "<b>" + getIcon("file", "primary") + "</span> Staged Files:</b> " + files.map(x => x.name).join(", ") + "<p><b>" + getIcon("check", "success") + "</span> Staged Metadata:</b> " + (stagedStations.length ? stagedFileContent : "None"); 

    });

  });

}

function readMultipleFiles(files, callback) {

  /* function readMultipleFiles
   * Uses the HTML5 FileReader API to read mutliple fires and fire
   * a callback with its contents
   */

  var readFile
  var fileContents = new Array();

  // IIFE to read multiple files
  (readFile = function(file) {

    // All files were read
    if(!files.length) {
      return callback(fileContents);
    }

    var file = files.pop();
    var reader = new FileReader();

    // XML should be readable as text
    reader.readAsText(file);

    // Callback when one file is read
    reader.onload = function() {

      console.debug("FileReader read file " + file.name + " (" + file.size + " bytes)");

      // Append the result
      fileContents.push({
        "name": file.name,
        "data": reader.result,
        "size": file.size
      });

      // More files to read: continue
      readFile();

    }

  })();

}

function parseQuery(queryString) {

  /* Function parseQuery
   * Parses query string to query object
   */

  function trimQueryString(queryString) {

    /* Function trimQueryString
     * Removes leading ? token from query string
     */

    if(queryString.charAt(0) === "?") {
      return queryString.substr(1);
    }

    return queryString;

  }

  var queryObject = new Object;

  trimQueryString(queryString).split("&").forEach(function(key) {
    var pair = key.split('=').map(decodeURIComponent);
    queryObject[pair[0]] = pair[1] || '';
  });

  return queryObject;

}

new App();

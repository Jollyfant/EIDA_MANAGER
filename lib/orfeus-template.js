/*
 * lib/orfeus-template.js
 * 
 * Wrapper for HTML templates
 *
 * Copyright: ORFEUS Data Center
 * Author: Mathijs Koymans, 2018
 *
 */

// Import the status codes
const { STATUS_CODES } = require("http");

const { E_HTTP_TEAPOT } = require("./lib/orfeus-http");
const CONFIG = require("./config");

function generateProfile(session) {

  /* function generateProfile
   * Generates HTML for the main profile page
   */

  if(session.role === "admin") {
    var fdsnwsQueryString = "";  
  } else {
    var fdsnwsQueryString = "?" + [
      "level=response",
      "network=" + session.prototype.network.code,
      (session.prototype.network.start ? "start=" + session.prototype.network.start.toISOString() : ""),
      (session.prototype.end ? "end=" + session.prototype.end.toISOString() : "")
    ].join("&");
  }

  return [
    generateHeader(),
    generateWelcome(session),
    "      <ul class='nav nav-tabs nav-justified' role='tablist'>",
    "        <li class='nav-item'>",
    "          <a class='nav-link active' role='tab' data-toggle='tab' href='#map-container-tab'><span class='fa fa-map' aria-hidden='true'></span> &nbsp; Map Display</a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#table-container-tab'><span class='fa fa-table' aria-hidden='true'></span> &nbsp; Tabular Display</a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#settings-container-tab'><span class='fa fa-cog' aria-hidden='true'></span> &nbsp; Metadata</a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#seedlink-container-tab'><span class='fa fa-plug' aria-hidden='true'></span> &nbsp; Seedlink</a>",
    "        </li>",
    "      </ul>",
    "      <div class='tab-content'>",
    "        <div class='tab-pane active' id='map-container-tab' role='tabpanel'>",
    "          <div class='map-container'>",
    "            <div style='position: relative;'>",
    "              <div id='map'></div>",
    "              <div class='alert alert-info' id='map-legend'></div>",
    "            </div>",
    "            <div class='card'>",
    "              <div class='card-header'>",
    "                <select class='form-control' id='map-display'>",
    "                  <option value='operational'>Operational Status</option>",
    "                  <option value='latency'>Latency Status</option>",
    "                  <option value='deployment'>Deployment Status</option>",
    "                </select>",
    "                <hr>",
    "                <div style='float: right;'>",
    "                  <button class='btn btn-link' onClick='downloadAsKML()'><span class='fas fa-file-download' aria-hidden='true'></span> <small>Download KML</small></button>",
    "                  &nbsp;",
    "                  <button class='btn btn-link' onClick='downloadAsGeoJSON()'><span class='fas fa-file-download' aria-hidden='true'></span> <small>Download GeoJSON</small></button>",
    "                </div>",
    "                <div id='map-information'></div>",
    "              </div>",
    "            </div>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='table-container-tab' role='tabpanel'>",
    "          <div id='table-container'></div>",
    "          <div id='table-information'></div>",
    "          <hr>",
    "          <div class='card'>",
    "            <div class='card-header'>",
    "              <div style='float: right;'>",
    "                <a class='btn btn-link' href='" + CONFIG.FDSNWS.STATION.HOST + fdsnwsQueryString + "'><span class='fas fa-file-download' aria-hidden='true'></span> <small>Download StationXML</small></a>",
    "                &nbsp;",
    "                <button class='btn btn-link' onClick='downloadAsJSON()'><span class='fas fa-file-download' aria-hidden='true'></span> <small>Download JSON</small></button>",
    "                &nbsp;",
    "                <button class='btn btn-link' onClick='downloadAsCSV()'><span class='fas fa-file-download' aria-hidden='true'></span> <small>Download CSV</small></button>",
    "              </div>",
    "            </div>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='settings-container-tab' role='tabpanel'>",
    "          <h4> Metadata Management </h4>",
    "          <div style='display: none;' id='metadata-submission'>",
    "            <p> Use this form to submit new station metadata to your EIDA data center. Metadata is curated and processed before being exposed by the data center. You can follow the progress your metadata here. Station metadata that is exposed by the webservice will no longer be visible in the table below. This process may some time. <b>Valid StationXML is required and must follow your <a href='/api/prototype'>network prototype</a> definition.</b>",
    "            <form class='form-inline' method='post' action='upload' enctype='multipart/form-data'>",
    "              <label class='custom-file'>",
    "                <input id='file-stage' name='file-data' type='file' class='form-control-file' aria-describedby='fileHelp' required multiple>",
    "                <span class='custom-file-control'></span>",
    "              </label>",
    "              &nbsp; <input id='file-submit' class='btn btn-success' type='submit' value='Send' disabled> &nbsp;",
    "              <label class='form-check-label'>",
    "                <input id='make-restricted' name='restricted' class='form-check-input' type='checkbox'> Restrict stations",
    "              </label>",
    "            </form>",
    "            <small id='file-help' class='form-text text-muted'></small>",
    "          </div>",
    "          <p>",
    "          <div id='table-staged-metadata'></div>",
    "          <div style='text-align: center;'>",
    "            <div id='table-staged-legend' style='display: none;'>",
    "              <small>",
    "              <span class='text-danger'><span class='fas fa-times'></span><b> Rejected</b></span> - Metadata was rejected",
    "              &nbsp;&nbsp;<span class='text-warning'><span class='fa fa-clock'></span><b> Pending</b></span> - Metadata was submitted",
    "              &nbsp;&nbsp;<span class='text-warning'><span class='fa fa-flag'></span><b> Validated</b></span> - Metadata was validated",
    "              &nbsp;&nbsp;<span class='text-info'><span class='fa fa-cogs'></span><b> Converted</b></span> - Metadata was converted",
    "              &nbsp;&nbsp;<span class='text-success'><span class='fa fa-check'></span><b> Approved</b></span> - Approved for inclusion",
    "              </small>",
    "            </div>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='seedlink-container-tab' role='tabpanel'>",
    "          <h4> Seedlink Management </h4>",
    "          <p> Use this form to define a new Seedlink server. Stations that are being archived by your data center are colored green.",
    "          <form class='form-inline' method='post' action='seedlink'>",
    "            <div class='input-group'>",
    "              <span class='input-group-addon'> Connection </span></span>",
    "              <input name='host' class='form-control' placeholder='Address' required>",
    "              <span class='input-group-addon'>:</span>",
    "              <input maxlength='5'  name='port' class='form-control' value='18000' placeholder='Port' required>",
    "              &nbsp; <input class='btn btn-success' type='submit' value='Submit'>",
    "            </div>",
    "          </form>",
    "          <hr>",
    "          <h3> Submitted Seedlink Servers </h3>",
    "          <div id='seedlink-connection-table'></div>",
    "          <small>Your EIDA Data Center (" + CONFIG.NODE.ID + ") connects with the following IP address: <b>" + CONFIG.EXTERNAL.IP + "</b>. Please make sure your firewall settings permit connections from this address.</small>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  </body>",
    generateFooter(),
    generateFooterApp(),
    "<html>"
  ].join("\n");

}

function generateAdmin(session) {

  return [
    generateHeader(),
    generateWelcome(session),
    "      <ul class='nav nav-tabs nav-justified' role='tablist'>",
    "        <li class='nav-item'>",
    "          <a class='nav-link active' role='tab' data-toggle='tab' href='#status-tab'><span class='fas fa-signal' aria-hidden='true'></span> &nbsp; Webservice Status </a>",
    "        </li>",
    "        <li class='nav-item'>",
    "          <a class='nav-link' role='tab' data-toggle='tab' href='#rpc-tab'><span class='fas fa-cog' aria-hidden='true'></span> &nbsp; RPC</a>",
    "        </li>",
    "      </ul>",
    "      <div class='tab-content'>",
    "        <div class='tab-pane active' id='status-tab' role='tabpanel'>",
    "          <h3> Status <small> Webservice Status </small> </h3>",
    "          <hr>",
    "          <div class='row'>",
    "            <div class='col-md-3'>",
    "              <div id='card-dataselect' class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>FDSNWS Dataselect</h5>",
    "                  <p id='card-dataselect-text' class='card-text'></p>",
    "                </div>",
    "              </div>",
    "            </div>",
    "            <div class='col-md-3'>",
    "              <div id='card-station' class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>FDSNWS Station</h5>",
    "                  <p id='card-station-text' class='card-text'></p>",
    "                </div>",
    "              </div>",
    "            </div>",
    "            <div class='col-md-3'>",
    "              <div id='card-routing' class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>EIDAWS Routing</h5>",
    "                  <p id='card-routing-text' class='card-text'></p>",
    "                </div>",
    "              </div>",
    "            </div>",
    "            <div class='col-md-3'>",
    "              <div id='card-wfcatalog' class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>EIDAWS WFCatalog</h5>",
    "                  <p id='card-wfcatalog-text' class='card-text'></p>",
    "                </div>",
    "              </div>",
    "            </div>",
    "          </div>",
    "        </div>",
    "        <div class='tab-pane' id='rpc-tab' role='tabpanel'>",
    "          <h3> RPC <small> Remote Procedure Calls </small> </h3>",
    "          <hr>",
    "          <div class='row'>",
    "            <div class='col-md-4'>",
    "              <div class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>Full Inventory</h5>",
    "                  <p class='card-text'>Download the full accepted SC3ML inventory.</p>",
    "                  <a href='/rpc/inventory' class='btn btn-success btn-sm'><span class='fas fa-cogs' aria-hidden='true'></span> Download Inventory </a>",
    "                </div>",
    "              </div>",
    "            </div>",
    "            <div class='col-md-4'>",
    "              <div class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>Update Prototypes</h5>",
    "                  <p class='card-text'>Call to update network prototypes from disk to the database.</p>",
    "                  <a href='/rpc/prototypes' class='btn btn-success btn-sm'><span class='fas fa-cogs' aria-hidden='true'></span> Update Prototypes </a>",
    "                </div>",
    "              </div>",
    "            </div>",
    "            <div class='col-md-4'>",
    "              <div class='card'>",
    "                <div class='card-block'>",
    "                  <h5 class='card-title'>Unavailable</h5>",
    "                  <p class='card-text'>Not implemented.</p>",
    "                </div>",
    "              </div>",
    "            </div>",
    "          </div>",
    "          <hr>",
    "          <div id='prototype-table'></div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  </div>",
    "</body>",
    generateFooter(),
    generateFooterApp(),
    "<html>"
  ].join("\n");

}

function generateWelcomeInformation(session) {

  /* Template.generateWelcomeInformation
   * template for top session banner
   */

  function generateVisitInformation(visited) {
  
    /* function generateVisitInformation
     * Generates string for last visited information
     */

    if(!visited) {
      return "<b>First visit! Welcome to the EIDA Manager</b>";
    }
  
    return "Last visit at <span class='fas fa-clock'></span> <b>" + visited.toISOString() + "</b>"
  
  }

  return [
    "      <div class='alert alert-info'>",
    "        <div style='float: right;'>",
    "          <small>",
    generateVisitInformation(session.visited),
    "          </small>",
    "        </div>",
    "        <h3>",
    "          <span class='fa fa-user-" + (session.role === "admin" ? "circle text-danger" : "circle") + "' aria-hidden='true'></span> " + session.username + " <small class='text-muted'><span id='doi-link'></span></small>",
    "        </h3>",
    "      </div>",
  ].join("\n");

}

function generateWelcome(session) {

  /* function generateWelcome
   * Generates HTML for the welcome header 
   */

  return [
    "    <script>const USER_NETWORK = " + JSON.stringify(session.prototype.network) + ";</script>",
    "    <div class='container'>",
    "      <div style='text-align: center;'>",
    "        <img src='/images/knmi.png'>",
    "      </div>",
    "      <div style='float: right;'>",
    "        <a href='/home/messages'><span class='badge badge-success'><span class='fa fa-envelope' aria-hidden='true'></span> <small><span id='number-messages'></span></small></span></a>",
    "        &nbsp;",
    "        <a href='/logout' onclick='return confirm(\"Are you sure you want to log out?\")'><span class='fas fa-sign-out-alt' aria-hidden='true'></span><small><b> Logout</b></small></a>",
    "      </div>",
    "      <h2 class='form-signin-heading'><span style='color: #C03;'>E</span>IDA Manager <small class='text-muted'>" + CONFIG.NODE.ID + "</small></h2>",
    generateWelcomeInformation(session),
    "      <div id='breadcrumb-container'></div>",
  ].join("\n");

}

function generateStationDetails(session) {

  /* function generateStationDetails
   * Generates HTML for a station detail page
   */

  return [
    generateHeader(),
    generateWelcome(session),
    "  <body>",
    "    <div class='row'>",
    "      <div class='col'>",
    "        <div id='map'></div>",
    "          <div class='card'>",
    "            <div class='card-header'>",
    "              <div id='map-information'></div>",
    "            </div>",
    "            <div class='card-block'>",
    "              <h4><span class='far fa-heart text-danger' aria-hidden='true'></span> Seedlink Health</h4>",
    "              <div id='channel-information-latency'></div>",
    "                <div style='float: right;'>",
    "                  <small><span class='fa fa-exclamation text-danger'></span> Metadata unavailable from FDSNWS</small>",
    "                </div>",
    "              </div>",
    "            </div>",
    "          </div>",
    "          <div class='col'>",
    "            <h4><span id='channel-information-header'></span> <small>FDSNWS Channel Information</small></h4>",
    "            <hr>",
    "            <div class='form-check alert alert-info' style='text-align: center;'>",
    "              <label class='form-check-label'>",
    "                <input id='hide-channels' class='form-check-input' type='checkbox' value=''> Show Closed Channels",
    "              </label>",
    "              &nbsp;",
    "              <label class='form-check-label'>",
    "                <input id='connect-seedlink' class='form-check-input' type='checkbox' value=''> Connect to Seedlink",
    "              </label>",
    "            </div>",
    "            <div class='progress' style='display: none; margin-bottom: 16px;' id='response-loading-bar'><div style='height: 20px;' class='progress-bar progress-bar-striped progress-bar-animated bg-success' role='progressbar' aria-valuenow='75' aria-valuemin='0' aria-valuemax='100'></div></div>",
    "            <div id='response-amplitude'></div>",
    "            <div id='response-phase'></div>",
    "            <div id='channel-information'></div>",
    "          </div>",
    "      </div>",
    "      <br>",
    "      <div id='accordion2'>",
    "        <div class='card'>",
    "          <div class='card-header small' id='headingOne2'>",
    "            <h5 class='mb-0'>",
    "              <button class='btn btn-link' data-toggle='collapse' data-target='#collapseOne2' aria-expanded='true' aria-controls='collapseOne2'>",
    "                <span class='fa fa-history'></span> Metadata submission history for <span id='history-table-title'></span>",
    "              </button>",
    "            </h5>",
    "          </div>",
    "          <div id='collapseOne2' class='collapse' aria-labelledby='headingOne2' data-parent='#accordion2'>",
    "            <div class='card-block'>",
    "              <div id='metadata-history'></div>",
    "            </div>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    "  </body>",
    generateFooter(),
    generateFooterApp(),
    "<html>"
  ].join("\n");

}

function generateNewMessageTemplate(invalid, session) {

  /* function generateNewMessageTemplate
   * Returns HTML template for creating a new message
   */

  return [
    generateHeader(),
    generateWelcome(session),
    "      <form class='message-form' method='post' action='/send'>",
    "        <div id='message-information'></div>",
    "        <h3>Submit new message</h3>",
    "        <div class='input-group'>",
    "          <span class='input-group-addon'> Subject </span>",
    "          <input name='subject' class='form-control' placeholder='Subject' required autofocus>",
    "          <span class='input-group-addon'> Recipient </span>",
    "          <input name='recipient' class='form-control' placeholder='Recipient' required>",
    "        </div>",
    "        <div class='input-group'>",
    "          <textarea class='form-control' name='content' class='form-control' placeholder='Message'></textarea>",
    "        </div>",
    "        <hr>",
    "        <button class='btn btn-lg btn-primary btn-block' type='submit'><span class='fa fa-location-arrow' aria-hidden='true'></span> Send</button>",
    "      <small>Tip! To send a message to the administrators specify <b>administrators</b> as the recipient.</small>",
    "      </form>",
    generateFooter(),
    generateFooterApp()
  ].join("\n");

}

function generateMessages(session) {

  /* function generateMessages
   * Template for private message inbox
   */

  return [
    generateHeader(),
    generateWelcome(session),
    "    <div style='text-align: right;'>",
    "      <a class='btn btn-success btn-sm' href='/home/messages/new'><span class='fa fa-plus-square'></span> New Message</a>",
    "    </div>",
    "    <br>",
    "    <ul class='nav nav-tabs nav-justified' role='tablist'>",
    "      <li class='nav-item'>",
    "        <a class='nav-link active' role='tab' data-toggle='tab' href='#messages-inbox-tab'><span class='fa fa-envelope-o' aria-hidden='true'></span> &nbsp; Message Inbox</a>",
    "      </li>",
    "      <li class='nav-item'>",
    "        <a class='nav-link' role='tab' data-toggle='tab' href='#messages-sent-tab'><span class='fa fa-location-arrow' aria-hidden='true'></span> &nbsp; Sent Messages</a>",
    "      </li>",
    "    </ul>",
    "    <div class='tab-content'>",
    "      <div class='tab-pane active' id='messages-inbox-tab' role='tabpanel'>",
    "        <div id='message-content'></div>",
    "        <div style='text-align: right;'>",
    "          <button onClick='deleteAllMessages(\"inbox\")' class='btn btn-danger btn-sm' id='delete-all-messages'><span class='fa fa-minus-square'></span> &nbsp; Delete All</button>",
    "        </div>",
    "      </div>",
    "      <div class='tab-pane' id='messages-sent-tab' role='tabpanel'>",
    "        <div id='message-content-sent'></div>",
    "          <div style='text-align: right;'>",
    "            <button onClick='deleteAllMessages(\"sent\")' class='btn btn-danger btn-sm' id='delete-all-messages'><span class='fa fa-minus-square'></span> &nbsp; Delete All</button>",
    "          </div>",
    "        </div>",
    "      </div>",
    "    </div>",
    generateFooter(),
    generateFooterApp()
  ].join("\n");

}

function generateMessageDetails(session) {

  /* function generateMessageDetails
   * Generates HTML for a single message
   */

  return [
    generateHeader(),
    generateWelcome(session),
    "    <div id='message-detail'></div>",
    generateFooter(),
    generateFooterApp()
  ].join("\n");

}

function generateModal() {

  /* function generateModal
   * Generates the HTML for the modal window
   */

  return [
    "  <div class='modal fade' id='modal-alert' tabindex='-1' role='dialog' aria-labelledby='exampleModalCenterTitle' aria-hidden='true'>",
    "    <div class='modal-dialog h-100 d-flex flex-column justify-content-center my-0' role='document'>",
    "      <div class='modal-content'>",
    "        <div class='modal-header'>",
    "          <h4 class='modal-title' id='modal-title'><span class='text-danger'>E</span>IDA Manager</h4>",
    "          <button type='button' class='close' data-dismiss='modal' aria-label='Close'>",
    "            <span aria-hidden='true'>&times;</span>",
    "          </button>",
    "        </div>",
    "        <div id='modal-content' class='modal-body' style='text-align: center;'></div>",
    "      </div>",
    "    </div>",
    "  </div>"
  ].join("\n");

}


function generateFooter() {

  /* function generateFooter
   * Generates the footer HTML
   */

  return [
    generateModal(),
    "  <footer class='container utext-muted'>",
    "  <hr>",
    "  <b><span class='text-danger'>E</span>IDA Manager</b> &copy; " + new Date().getFullYear() + " <a href='https://orfeus-eu.org'>ORFEUS Data Center</a>. All Rights Reserved. Licensed under <a href='https://opensource.org/licenses/MIT/'><span class='fa fa-balance-scale'></span> MIT</a>.",
    "  <div style='float: right;'><small>Version v" + CONFIG.__VERSION__ + "</small></div>",
    "  </footer>",
    "  <link rel='stylesheet' href='https://use.fontawesome.com/releases/v5.2.0/css/all.css' integrity='sha384-hWVjflwFxL6sNzntih27bfxkr27PmbbK/iSvJ+a4+0owXq79v+lsFkW54bOGbiDQ' crossorigin='anonymous'>",
    "  <link rel='stylesheet' href='https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-alpha.6/css/bootstrap.min.css' integrity='sha384-rwoIResjU2yc3z8GV/NPeZWAv56rSmLldC3R/AZzGRnGxQQKnKkoFVhFQhNUwEyJ' crossorigin='anonymous'>",
    "  <script src='https://code.jquery.com/jquery-3.1.1.min.js'></script>",
    "  <script src='https://cdnjs.cloudflare.com/ajax/libs/tether/1.4.0/js/tether.min.js'></script>",
    "  <script src='https://maxcdn.bootstrapcdn.com/bootstrap/4.0.0-alpha.6/js/bootstrap.min.js'></script>",
    "  <script src='https://cdnjs.cloudflare.com/ajax/libs/popper.js/1.12.9/umd/popper.min.js' integrity='sha384-ApNbgh9B+Y1QKtv3Rn7W3mgPxhU9K/ScQsAP7hUibX39j7fakFPskvXusvfa0b4Q' crossorigin='anonymous'></script>"
  ].join("\n");

}

function generateFooterApp() {

  /* function generateFooterApp
   * Generates the script footer for the application
   */

  return [
    "  <script src='https://code.highcharts.com/highcharts.js'></script>",
    "  <script src='https://maps.googleapis.com/maps/api/js?key=AIzaSyAN3tYdvQ5tSS5NIKwZX-ZqhsM4NApVV_I'></script>",
    "  <script src='/js/table.js'></script>",
    "  <script src='/js/fdsn-station-xml-validator.js'></script>",
    "  <script src='/js/seedlink.js'></script>",
    "  <script src='/js/app.js'></script>",
  ].join("\n");

}

function generateLogin(invalid) {

  /* function generateLogin
   * Generates the HTML for the log in page
   */

  return [
    generateHeader(),
    "  <body>",
    "    <div style='text-align: center;'>",
    "      <img src='/images/knmi.png'>",
    "    </div>",
    "    <div class='container'>",
    "      <form class='form-signin' method='post' action='authenticate'>",
    "        <h2 class='form-signin-heading'><span style='color: #C03;'>E</span>IDA Manager</h2>",
    "        <div class='input-group'>",
    "          <span class='input-group-addon'><span class='fa fa-user-circle' aria-hidden='true'></span></span>",
    "          <input name='username' class='form-control' placeholder='Username' required autofocus>",
    "        </div>",
    "        <div class='input-group'>",
    "          <span class='input-group-addon'><span class='fa fa-key' aria-hidden='true'></span></span>",
    "          <input name='password' type='password' class='form-control' placeholder='Password' required>",
    "        </div>",
    "        <hr>",
    "        <div style='text-align: center;'>",
    generateInvalid(invalid),
    "        </div>",
    "        <button class='btn btn-lg btn-primary btn-block' type='submit'><span class='fa fa-lock' aria-hidden='true'></span> Authenticate</button>",
    "      </form>",
    "    </div>",
    "  </body>",
    generateFooter(),
    "</html>"
  ].join("\n");

}

function generateHeader() {

  /* function generateHeader
   * Generates the HTML document header for all pages
   */

  return [
    "<!DOCTYPE html>", 
    "<html lang='en'>", 
    "  <head>", 
    "    <meta charset='utf-8'>", 
    "    <meta name='viewport' content='width=device-width, initial-scale=1, shrink-to-fit=no'>", 
    "    <meta name='description' content='EIDA Manager'>", 
    "    <meta name='author' content='ORFEUS Data Center'>", 
    "    <title>EIDA Manager</title>", 
    "    <link rel='stylesheet' href='/css/style.css'/>", 
    "    <link rel='shortcut icon' type='image/x-icon' href='/images/eida.png'/>",
    "  </head>",
  ].join("\n");

}

function generateMessageAlert(type, message) {

  /* function generateMessageAlert
   * Generates HTML for an alert message with icon
   */

  function getAlertIcon(type) {

    /* function generateMessageAlert::getAlertIcon
     * Returns an icon related to the alert type
     */

    function Icon(icon, color) {
    
      /* function Icon
       * Returns font-awesome icon
       */
    
      return "<span class='fa fa-" + icon + " text-" + color + "'></span>";
    
    }

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

function generateInvalid(invalid) {

  /* function generateInvalid
   * Generates alert message box with status message
   */

  const E_USERNAME_INVALID = "Username is invalid.";
  const E_PASSWORD_INVALID = "Password is invalid.";
  const S_LOGGED_OUT = "Succesfully logged out.";

  // Write the alert message
  if(invalid.endsWith("E_PASSWORD_INVALID")) {
    return generateMessageAlert("danger", E_PASSWORD_INVALID);
  } else if(invalid.endsWith("E_USERNAME_INVALID")) {
    return generateMessageAlert("danger", E_USERNAME_INVALID);
  } else if(invalid.endsWith("S_LOGGED_OUT")) {
    return generateMessageAlert("success", S_LOGGED_OUT);
  }

}

function generateHTTPError(statusCode) {

  /* function generateHTTPError
   * Returns HTTP for invalid statusCode
   */
 
  // Unknown status code
  if(!STATUS_CODES.hasOwnProperty(statusCode)) {
    statusCode = E_HTTP_TEAPOT;
  }

  // Create the error body
  return [
    generateHeader(),
    "  <body style='padding-top: 20px;'>",
    "    <div class='container'>",
    "      <h2 class='text-muted'><span style='color: #C03;'>" + statusCode +"</span> " + STATUS_CODES[statusCode] + " </h2>",
    statusCode === 401 ? "The request is unauthorized. Please return to the <a href='/'>login</a> page." : "",
    statusCode === 404 ? "The page could not be found." : "",
    statusCode === 413 ? "The submitted payload is too large to accept." : "",
    statusCode === 500 ? "The server experience an internal error." : "",
    statusCode === 501 ? "The request method is not supported under this path." : "",
    statusCode === 503 ? "The service is currently closed for maintenance." : "",
    "    </div>",
    "  </body>",
    generateFooter(),
    "</html>"
  ].join("\n");

}

module.exports = {
  generateInvalid,
  generateHeader,
  generateLogin,
  generateFooterApp,
  generateFooter,
  generateMessageDetails,
  generateMessages,
  generateNewMessageTemplate,
  generateStationDetails,
  generateWelcome,
  generateWelcomeInformation,
  generateProfile,
  generateHTTPError,
  generateAdmin
}

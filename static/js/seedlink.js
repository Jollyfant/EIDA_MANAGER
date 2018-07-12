const SEEDLINK_RINGBUFFER_LENGTH = 512;
const SEEDLINK_CHART_HEIGHT = 100;

var SeedlinkChannel = function(data) {

  /* Class SeedlinkChannel
   * Class for handling individual seedlink channels
   */

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

SeedlinkChannel.prototype.CreateZeroBuffer = function(start, rate, value) {

  this.ringBuffer = new Array();

  // Backwards zero fill with the initial value
  for(var i = 0; i < SEEDLINK_RINGBUFFER_LENGTH; i++) {
    this.ringBuffer.push({
      "x": start - ((SEEDLINK_RINGBUFFER_LENGTH - i) * (1000 / rate)),
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
    this.ringBuffer.push({
      "x": this.start + (i * (1000 / sampleRate)),
      "y": data[i]
    });
  }

  // Keep a maximum of $SEEDLINK_RINGBUFFER_LENGTH points in the buffer
  this.ringBuffer.splice(0, this.ringBuffer.length - SEEDLINK_RINGBUFFER_LENGTH);

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

  var heartbeatElement = Element("heartbeat-" + data.location + "-" + data.channel);

  if(heartbeatElement !== null) {
    heartbeatElement.innerHTML = getIcon("heart-o", "success") + " <span class='text-success'><b>Heartbeat</b></span>";
    $(heartbeatElement).show()
    $(heartbeatElement).fadeOut(1500)
  }

  // Currently expected endtime is different from the next
  // record start time; introduce a gap
  if(this.end && this.end !== data.start) {
    this.ringBuffer.push({
      "x": this.end,
      "y": null
    });
  }

  this.AddBuffer(data.data, data.sampleRate);

  this.end = data.end;

  this.plot();

}

SeedlinkChannel.prototype.plot = function() {

  // Redraw the chart container
  this.chartContainer.highcharts({
    "chart": {
      "height": SEEDLINK_CHART_HEIGHT,
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
        "data": this.ringBuffer
    }]
  });

}

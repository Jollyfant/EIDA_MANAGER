function responsePhaseChart(result) {

  /*
   * Function responsePhaseChart
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

  /*
   * Function responseAmplitudeChart
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

function barChart(data) {

  /*
   * Function barChart
   * Creates a bar chart for the statistics tab
   */

  var subtitle = getSubtitle(CONFIG.NETWORK.network.code);

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

}

function pieChart(data) {

  /*
   * Function pieChart
   * Creates a pie chart for showing waveform types exported
   */

  var subtitle = getSubtitle(CONFIG.NETWORK.network.code);

  Highcharts.chart("statistics-chart-pie", {
    "chart": {
      "type": "pie"
    },
    "title": {
      "text": "Type of Waveform Data Exported"
    },
    "subtitle": {
      "text": subtitle
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
      "name": "Waveform Types",
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

function getSubtitle(network) {

  if(network === "*") {
    return "All networks";
  } else {
    return "Network <b>" + network + "</b>";
  }

}

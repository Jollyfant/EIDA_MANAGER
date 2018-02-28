const Database = require("./lib/orfeus-database");
const CONFIG = require("./config");
const E_CHILD_PROCESS = 1;
const childProcess = require("child_process");

Database.connect(function(error) {

  const pipeline = [{
    "$group": {
      "_id": {
        "network": "$network",
        "station": "$station",
      },
      "id": {
        "$last": "$_id"
      },
      "created": {
        "$last": "$created"
      },
      "status": {
        "$last": "$status"
      },
      "filepath": {
        "$last": "$filepath"
      }
    }
  }, {
    "$match": {
        "status": {
          "$in": [
            Database.METADATA_STATUS_MERGED,
            Database.METADATA_STATUS_COMPLETED
          ]
        }
      }
  }];

  // Query the database
  Database.files().aggregate(pipeline).toArray(function(error, documents) {

    if(error || documents.length === 0) {
      return Database.close();
    }

    // Get the sc3ml files
    documents = documents.map(function(x) {
      return x.filepath + ".sc3ml";
    });

    var SEISCOMP_COMMAND = [
      "exec",
      "scinv",
      "merge"
    ];

    // Add all documents to be merged
    SEISCOMP_COMMAND = SEISCOMP_COMMAND.concat(documents);
    SEISCOMP_COMMAND = SEISCOMP_COMMAND.concat(["-o", "full.xml"]);

    // Spawn subprocess
    const convertor = childProcess.spawn(CONFIG.SEISCOMP.PROCESS, SEISCOMP_COMMAND);

    // Print progress (to stderr???)
    convertor.stderr.on("data", function(data) {
      console.log(data.toString());
    });

    // Child process has closed
    convertor.on("close", function(code) {
      Database.close();
    });

  });


});

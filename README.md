# EIDA Manager

Prototype for an EIDA metadata management system. This interface is built on an HTTP API microservice architecture and consists of the following (optional) modules:

  * https://github.com/Jollyfant/nodejs-seedlink-latencies-proxy.git
  * https://github.com/Jollyfant/node-seedlink-data-proxy.git
  * https://github.com/Jollyfant/nodejs-seedlink-stations-proxy.git
  * https://github.com/Jollyfant/nodejs-doi-webservice.git

Each service can be run as a seperate NodeJS process or built to a Docker image:

  docker build -t {service-name}:1.0 .

All modules must be configured in `docker-compose.yml`. When building the EIDA Manager, make sure that `seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz` or another version of SeisComP3 is available in the root folder and that the configuration is valid for your deployment.

## Running with Docker

  docker-compose up

## Running without Docker

Without Docker, a manual installation of `MongoDB` and `SeisComP3` are required.

## Network prototypes

Network prototypes are metadata definitions on a network level (e.g. start time, description). All submitted metadata is compared to its respective network prototype. This is a requirement put in place by SeisComP3 when merging inventories where all top-level network attributes must be identical. Because metadata is sourced from multiple sources, we must define a prototype that all stations from a single network must adhere to (step: merged in processing pipeline)

The prototype files (sc3ml) must be downloaded in advance and are placed in the prototype directory.

## EIDA Manager Metadata handling

Metadata is submitted through the EIDA Manager user interface. All metadata is validated (e.g. schema; sanity checks) by the client and server. Metadata is split to a station level and written to disk, and an entry in the database is made. This triggers the automatic metadata processing pipeline (pending -> validated -> converted -> merged -> approved). When new metadata is submitted, the old metadata is superseded but never removed. The newer metadata is saved under a different name and subject to the same processing pipeline until it is approved for inclusion by the system.

Network operators can follow their metadata through the system by the interface. If metadata is rejected for a reason, the operator can identify the problem and submit corrected metadata.

A daemon process (metadaemon) runs periodically and processes metadata. Occasionally it merges the most up-to-date inventory to a full inventory that can be manually supplied to SeisComP3 to expose the most recent metadata through FDSNWS webservices.

The system manages the complete history of all metadata submitted. Files that are not important (e.g. rejected files, or files that were never published through FDSNWS are purged from the system). This feature greatly increases the data provenance.

Processing Pipeline terminology:

  - Pending - Metadata is awaiting metadaemon process
  - Validated - Server side validation of the FDSNStationXML
  - Converted - SeisComP3 conversion from FDSNStationXML to valid SC3ML
  - Merged - Dummy SeisComP3 merge against the network prototype to reject existing merge conflicts
  - Approved - Valid SC3ML waiting idle to be combined to a full inventory by the metadaemon

  - Rejected - Metadata was rejected by the system
  - Terminated - Metadata processing was terminated
  - Available - Metadata is presently available through the FDSNWS Webservice

## Configuration

Configuration parameters are:

  - `__STDOUT__` Write logged information to stdout instead of file.
  - `__DEBUG__` Sets application in debug mode.
  - `__VERSION__` Application version.
  - `__CLOSED__` Can be set to `true` to close the service under maintenance. All requests will return HTTP status code 503 Service Unavailable.
  - `LOGFILE` Relative location of the service log file.
  - `PORT` Port that the application accepts HTTP connections under.
  - `HOST` The hostname that the application runs on.
  - `SEISCOMP.PROCESS` The location of the SeisComP3 process. Do not change if SeisComP3 is already available under `$PATH`.
  - `EXTERNAL.IP` The external IP address of the internal acquisition server. This setting notifies network operators of the address used to connect to their Seedlink server.
  - `STATIC.DIRECTORY` The directory of all static files served by the application webserver.
  - `MAXIMUM_POST_BYTES` Maximum number of bytes accepted by the server through POST requests before returning HTTP status code 413 Payload Too Large.
  - `METADATA.PATH` Path under which metadata submitted by network operators is stored on disk.
  - `METADATA.SCHEMA.PATH` Path under which the FDSNStationXML XSD schema is available for validation.
  - `METADATA.DAEMON.ENABLED` Enables the MetaDaemon that handles asynchronous processing of metadata through the pipeline.
  - `METADATA.DAEMON.SLEEP_INTERVAL_MS` Number of miliseconds the MetaDaemon sleeps after completing a pipeline, before waking up and checking for new submissions.
  - `FDSNWS.STATION.HOST` The URL of FDSN station webservice query path of the EIDA node running the application.
  - `FDSNWS.DATASELECT.HOST` The URL of FDSN dataselect webservice query path of the EIDA node running the application.
  - `NODE.ID` Shorthand identifier of the EIDA node running the application.
  - `NODE.NAME` The URL of the node FDSN dataselect webservice query path.
  - `SESSION.TIMEOUT` Number of seconds written in the HTTP response setting the sesion cookie lifetime.
  - `LATENCY.HOST` Host that the station latency service is running on.
  - `LATENCY.PORT` Port that the station latency service is running on.
  - `STATIONS.HOST` Host that the station seedlink service is running on.
  - `STATIONS.PORT` Port that the station seedlink service is running on.
  - `MONGO.NAME` Name of the database used by the application.
  - `MONGO.HOST` Host that the MongoDB is runnign on.
  - `MONGO.PORT` Port that the MongoDB is running on.

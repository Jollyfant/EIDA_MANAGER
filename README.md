# EIDA Manager

Prototype for an EIDA metadata management system. This interface is built on an HTTP API microservice architecture and consists of the following (optional) modules:

  * https://github.com/Jollyfant/nodejs-seedlink-latencies-proxy.git
  * https://github.com/Jollyfant/node-seedlink-data-proxy.git
  * https://github.com/Jollyfant/nodejs-seedlink-stations-proxy.git
  * https://github.com/Jollyfant/nodejs-doi-webservice.git
  * https://github.com/Jollyfant/bottle-response-api.git

Each service can be run as a seperate NodeJS (Python) process or built to a Docker image. See the repositories for details.

    docker build -t {service-name}:1.0 .

All modules must be configured in `docker-compose.yml`. When building the EIDA Manager, make sure that `seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz` or another version of SeisComP3 is available in the root folder (see Dockerfile) and that the configuration is valid for your deployment.

To build the EIDA Manager and Metadaemon run:

    docker build -t eida-manager:1.0 -f Dockerfile-manager .
    docker build -t eida-metadaemon:1.0 -f Dockerfile-metadaemon .

## Running with Docker

Before running docker-compose one needs to set up the MongoDB/MariaDB as described at the bottom of this README.

    docker-compose up

## Network prototypes

Network prototypes are metadata definitions on a network level (e.g. code, start, end, description). All submitted metadata from a network (identified by a code, start & end) is compared to its respective network prototype. This is a requirement put in place by SeisComP3 when merging inventories where all top-level network attributes *must* be identical. Because metadata is sourced from multiple users, we must define a prototype that all stations from a single network must be based on.

The prototype files (stationXML) must be downloaded outside of the application and put in the `/prototype` directory. Administrators may invoke an RPC that updates the network prototypes to the database. It is highly unrecommended to update existing prototypes -- as this will supersede all station metadata that was previously submitted. Adding new prototypes for new networks follows business as usual.

## EIDA Manager Metadata handling

Metadata is submitted through the EIDA Manager user interface. All metadata is validated (e.g. schema; sanity checks) by the client and server. Metadata is split to a station level and written to disk, and an entry in the database is made. This triggers the automatic metadata processing pipeline (`pending` -> `validated` -> `converted` -> `merged` -> `approved` -> `available`). When new metadata is submitted, the old metadata is superseded but never removed. The newer metadata is saved under a different name and subject to the same processing pipeline until it is approved for inclusion by the system.

Network operators can follow their metadata through the system by the interface. If metadata is rejected for a reason, the operator can identify the problem and submit corrected metadata.  A daemon process (metadaemon) runs periodically and processes metadata. Metadata that is deemed correct and was approved by the system can be exported, or automatically added to the SeisComP3 inventory database through the adminstrator panel.

The system manages a complete history of all metadata submitted. Files that are not important (e.g. rejected files, or files that were never published through FDSNWS are purged from the system automatically). This feature greatly increases the data provenance.

Processing Pipeline terminology:

  - `Pending` - Metadata is awaiting metadaemon process.
  - `Validated` - Server side validation of the FDSNStationXML (e.g. schema, sanity, user rights).
  - `Converted` - SeisComP3 conversion from FDSNStationXML to SeisComP3 SC3ML.
  - `Merged` - Dummy SeisComP3 merge against the network prototype to raise any merge conflicts.
  - `Approved` - Valid SC3ML waiting to be exposed by FDSNWS Station.

  - `Rejected` - Metadata was rejected by the system. Hover over the element to find the reason for rejection.
  - `Terminated` - Metadata processing was terminated by the user or administrator.
  - `Available` - Metadata is available through FDSNWS Station.

## Configuration

Configuration parameters are:

  - `__ACCESS__` Write HTTPD styled access log to logfile
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

## Setting up the SeisComP3 MySQL Database

Start and connect to a MariaDB image that will create the SeisComP3 database. Mount the volume (-v) that will retain the container data on the host and match it to the configuration of docker-compose. You need to add the database schema manually:

    Remember to replace {password}, {data-directory}, {container} with appropriate values

    $ docker run -d --rm -e "MYSQL_ROOT_PASSWORD={password}" -e "MYSQL_DATABASE=seiscomp3" -v {$pwd/data/mysql}:/var/lib/mysql mariadb:latest
    b6375277f9733fa1a0de1d048c0fe6bb04c49e997971c8c22f0dd999dc84ae3c
    $ cat schema/seiscomp3.sql | docker exec -i {container} mysql -uroot -ppassword seiscomp3
    $ docker stop {container}

The chosen root password needs to be configured in the `scconfig` directory before building the EIDA Manager image.

## Setting up the MongoDB Database

Start up and connect to a MongoDB image. Users need to be inserted manually (with a SHA256 password hash/salt) for now.

    $ docker run -d --rm -e "MONGO_INITDB_ROOT_USERNAME=root" -e "MONGO_INITDB_ROOT_PASSWORD=password" -v {$pwd/data/mongo}:/data/db mongo:latest
    b6375277f9733fa1a0de1d048c0fe6bb04c49e997971c8c22f0dd999dc84ae3c
    $ docker exec -it {container} mongo
    > use admin
    > db.auth("root", "password")
    > use orfeus-manager
    > db.users.insert({object})
    $ docker stop {container}

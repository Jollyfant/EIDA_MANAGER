# EIDA Manager

Prototype for an EIDA metadata management system. This interface is built on an HTTP API microservice architecture and requires the following modules:

  * https://github.com/Jollyfant/nodejs-seedlink-latencies-proxy.git
  * https://github.com/Jollyfant/node-seedlink-data-proxy.git
  * https://github.com/Jollyfant/nodejs-seedlink-stations-proxy.git
  * https://github.com/Jollyfant/nodejs-doi-webservice.git

Each service can be run as a seperate NodeJS process or built to a Docker image:

  docker build -t {service-name}:1.0 .

## Running with Docker

  docker-compose up

## Running without Docker

Without Docker, a manual installation of `MongoDB` and `SeisComP3` are required.

## Network prototypes

Network prototypes are metadata definitions on a network level (e.g. start time, description). All submitted metadata is compared to its respective network prototype. This is a requirement put in place by SeisComP3 when merging inventories where all top-level network attributes must be identical. Because metadata is sourced from multiple sources, we must define a prototype that all stations from a single network must adhere to (step: merged in processing pipeline)

The prototype files (sc3ml) must be downloaded in advance and are placed in the prototype directory.

## EIDA Manager Metadata handling

Metadata is submitted through the EIDA Manager user interface. All metadata is validated (e.g. schema; sanity checks) by the client and server. Metadata is split to a station level and written to disk, and an entry in the database is made. This triggers the automatic metadata processing pipeline (pending -> validated -> converted -> merged -> approved). When new metadata is submitted, the old metadata is superseded but never removed. The newer metadata is saved under a different name and subject to the same processing pipeline until it is approved for inclusion by the system.

Network operators can follow their metadata through the system by the interface. If metadata is rejected for a reason, the operator can identify the problem and re-submit corrected metadata.

A daemon process (metadaemon) runs periodically and processes metadata. Occasionally it merges the most up-to-date inventory to a full inventory that can be manually supplied to SeisComP3 to expose the most recent metadata through FDSNWS webservices.

Processing Pipeline terminology:

  * Pending - Metadata is awaiting metadaemon process
  * Validated - Server side validation of the FDSNStationXML
  * Converted - SeisComP3 conversion from FDSNStationXML to valid SC3ML
  * Merged - Dummy SeisComP3 merge against the network prototype to reject existing merge conflicts
  * Approved - Valid SC3ML waiting idle to be combined to a full inventory by the metadaemon

  * Rejected - Metadata was rejected by the system
  * Available - Metadata is presently available through the FDSNWS Webservice

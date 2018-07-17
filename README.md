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

Without Docker, an manual installation of `MongoDB` and `SeisComP3` are required.

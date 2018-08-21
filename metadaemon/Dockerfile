# Dockerfile for building the EIDA-Manager image
# Make sure to include "seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz" in this directory
#
# $ docker build -t eida-manager:1.0 .

# Node base image
FROM node:8

# Add some metadata
LABEL maintainer="Mathijs Koymans"
LABEL email="koymans@knmi.nl"

# Add metadaemon user
RUN useradd -ms /bin/bash metadaemon

# Set the source directory for the application
WORKDIR /home/metadaemon

# Copy the source code of SeisComP3
COPY seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
     seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Unpack SeisComP3 and install dependencies
RUN apt-get -y update \
        && apt-get -y install aptitude libxml2-utils \
        && tar -zxvf seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
        && yes | sh seiscomp3/share/deps/debian/8.0/install-base.sh \
        && rm seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Change SeisComP3 directory to metadaemon user
RUN chown -R metadaemon /home/metadaemon/seiscomp3

# Change user to metadaemon
USER metadaemon

# Copy package for Node dependencies
# So it does not rebuild when changing local source
COPY package*.json ./

# Install NodeJS dependencies
RUN npm install

# Copy rest of the source
COPY . .

# Run the NodeJS webserver
CMD ["npm", "start"]

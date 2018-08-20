# Dockerfile for building the EIDA-Manager image
# Make sure to include "seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz" in this directory
#
# $ docker build -t eida-manager:1.0 .

# Node base image
FROM node:8

# Add some metadata
LABEL maintainer="Mathijs Koymans"
LABEL email="koymans@knmi.nl"

# Add sysop user
RUN useradd -ms /bin/bash sysop

# Set the source directory for the application
WORKDIR /home/sysop

# Copy the source code of SeisComP3
COPY seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
     seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Unpack SeisComP3 and install dependencies
RUN apt-get -y update \
        && apt-get -y install python-pip python-dev aptitude libxml2-utils \
        && pip install python-dateutil twisted \
        && tar -zxvf seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
        && yes | sh seiscomp3/share/deps/debian/8.0/install-base.sh \
        && rm seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Copy the SeisComP3 configuration files
COPY scconfig/*.cfg seiscomp3/etc/

# Change SeisComP3 directory to sysop user
RUN chown -R sysop /home/sysop/seiscomp3

# Change user to sysop
USER sysop

# Copy package for Node dependencies
# So it does not rebuild when changing local source
COPY package*.json ./

# Install NodeJS dependencies
RUN npm install

# Set some environment variables
ENV SERVICE_HOST="" \
    SERVICE_PORT=""

# Copy rest of the source
COPY . .

# Expose port 8088 to the outside
EXPOSE 8088

CMD ["npm", "start"]

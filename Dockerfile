# Dockerfile for building EIDA manager image
# Make sure to include seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz in this directory
#
# $ docker build -t eida-manager:1.0 .

FROM node:8

# Add some metadata
LABEL maintainer="Mathijs Koymans"
LABEL email="koymans@knmi.nl"

# Set the source directory for the application
WORKDIR /usr/src/app

COPY seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
     seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Unpack SeisComP3
RUN tar -zxvf seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
	&& apt-get -y update \
	&& apt-get -y install aptitude libxml2-utils \
	&& sh seiscomp3/share/deps/debian/8.0/install-base.sh \
	&& rm seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Copy source code
COPY package*.json ./

# Install NodeJS dependencies
RUN npm install

# Set some environment variables
ENV INSTALL_DIR="/usr/src/app/seiscomp3"
ENV PATH="${PATH}:${INSTALL_DIR}/bin:${INSTALL_DIR}/sbin" \
    LD_LIBRARY_PATH="${LD_LIBRARY_PATH}:${INSTALL_DIR}/lib" \
    PYTHONPATH="${PYTHONPATH}:${INSTALL_DIR}/lib/python" \
    SERVICE_HOST="" \
    SERVICE_PORT=""

# Copy rest of the source
COPY . .

# Expose port 8088 to the outside
EXPOSE 8088

CMD ["npm", "start"]

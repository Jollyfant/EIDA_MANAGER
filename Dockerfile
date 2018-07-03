# Dockerfile for building EIDA manager image
# Make sure to include seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz in this directory
#
# $ docker build -t eida-manager:1.0 .

FROM node:8
MAINTAINER Mathijs Koymans

# Set the source directory for the application
WORKDIR /usr/src/app

# Copy source code
COPY . .

# Install NodeJS dependencies
RUN npm install

# Unpack SeisComP3
RUN tar -zxvf seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz \
	&& apt-get -y update \
	&& apt-get -y install aptitude libxml2-utils \
	&& sh seiscomp3/share/deps/debian/8.0/install-base.sh \
	&& rm seiscomp3-jakarta-2017.334.05-debian8-x86_64.tar.gz

# Set some environment variables
ENV INSTALL_DIR /usr/src/app/seiscomp3
ENV PATH $PATH:$INSTALL_DIR/bin:$INSTALL_DIR/sbin
ENV LD_LIBRARY_PATH $LD_LIBRARY_PATH:$INSTALL_DIR/lib
ENV PYTHONPATH $PYTHONPATH:$INSTALL_DIR/lib/python

# Get the network prototypes for EIDA Manager
RUN sh ./prototypes/prototypes.sh ODC

# Expose port 8088 to the outside
EXPOSE 8088

CMD ["npm", "start"]

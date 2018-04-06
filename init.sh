#!/bin/bash

LOCK_DIRECTORY="./lock"

# Modules
GIT_SEEDLINK_STATIONS="https://github.com/Jollyfant/NodeJS-Seedlink-Stations.git"
GIT_SEEDLINK_LATENCIES="https://github.com/Jollyfant/NodeJS-Seedlink-Latencies.git"

case $1 in

	install)

		# Clean previous installation
		rm -rf ./node_modules > /dev/null
		rm -rf ./NodeJS-* > /dev/null

		# Grab new source from GitHub & npm
		echo "Installing ORFEUS Manager dependencies"
		npm install
		git clone $GIT_SEEDLINK_STATIONS
		git clone $GIT_SEEDLINK_LATENCIES

		# Copy the configuration to the modules
		echo "Copying configuration to modules"
                cat config.json | python -c 'import json; import sys; print json.dumps(json.load(sys.stdin)["LATENCY"], indent=2)' > NodeJS-Seedlink-Latencies/config.json
                cat config.json | python -c 'import json; import sys; print json.dumps(json.load(sys.stdin)["STATIONS"], indent=2)' > NodeJS-Seedlink-Stations/config.json

		# Get the prototypes
                cat config.json | python -c 'import json; import sys; print json.dumps(json.load(sys.stdin)["NODE"]["ID"])' | xargs prototypes/prototype.sh

		echo "ORFEUS Manager can be started by giving: ./init.sh start"
		;;

	start)

		# Confirm MongoDB is running
		if ! pgrep -x "mongod" > /dev/null; then
			echo "Mongod is not running"
			exit 0
		fi

		if [ ! -x "$(command -v seiscomp)" ]; then
			echo "SeisComP3 is not installed"
			exit 0
		fi

		# Create lock directory
		if [ ! -d $LOCK_DIRECTORY ]; then
			mkdir $LOCK_DIRECTORY
		fi

		echo "Starting ORFEUS Manager";

		# Start two NodeJS microservices
		nohup node server.js &> /dev/null &
                echo $! > ./lock/server.pid &
		nohup node NodeJS-Seedlink-Latencies &> /dev/null &
                echo $! > ./lock/latency.pid &
		nohup node NodeJS-Seedlink-Stations &> /dev/null &
                echo $! > ./lock/stations.pid &
                ;;

	stop)
                if [ -z "$(ls -A $LOCK_DIRECTORY)" ]; then
                        echo "ORFEUS Manager is not running"
			exit 0
		fi

		echo "Stopping ORFEUS Manager";

		# Kill running processes
		for file in $LOCK_DIRECTORY/*; do
			kill $(cat $file) > /dev/null 2>&1
			rm $file
                done
		;;

	status)
		if [ -z "$(ls -A $LOCK_DIRECTORY)" ]; then
			echo "ORFEUS Manager is not running"
			exit 0
		fi

		# Get the status of running processes
		for file in $LOCK_DIRECTORY/*; do
			case $(basename $file) in
				server.pid)
					echo "ORFEUS Server Manager is running"
				;;
				latency.pid)
					echo "Latency server is running"
				;;
				stations.pid)
					echo "Station server is running"
				;;
			esac
		done
		
		;;
	*)
		echo "Give one of install|start|stop|status"
		;;
esac
exit 0

#!/bin/bash

LOCK_DIRECTORY="./lock"

case $1 in
	start)
		echo "Starting ORFEUS Manager";
		nohup node server.js &
                echo $! > ./lock/server.pid &
		nohup node NodeJS-Seedlink-Latencies/Latency.js &
                echo $! > ./lock/latency.pid &
		nohup node NodeJS-Seedlink-Server/Seedlink.js &
                echo $! > ./lock/seedlink.pid &
                ;;
	stop)
		echo "Stopping ORFEUS Manager";
		# Close running ORFEUS Manager processes
		for file in $LOCK_DIRECTORY/*; do
			# Kill running processes
			kill $(cat $file)
			# Remove lockfile
			rm $file
                done
		;;
	status)
		if [ -z "$(ls -A $LOCK_DIRECTORY)" ]; then
			echo "ORFEUS Manager is not running"
                else
			for file in $LOCK_DIRECTORY/*; do
				case $(basename $file) in
					server.pid)
						echo "ORFEUS Server Manager is running"
					;;
					latency.pid)
						echo "Latency server is running"
					;;
					seedlink.pid)
						echo "Seedlink server is running"
					;;
				esac
			done
		fi	
		;;
esac

exit 0

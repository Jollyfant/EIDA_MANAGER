#!/bin/bash

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
		for file in ./lock/*; do
			# Kill running processes
			kill $(cat $file)
			# Remove lockfile
			rm $file
                done
		;;
esac

exit 0

#!/bin/bash

case $1 in
	start)
		echo "Starting ORFEUS Manager";
		nohup node server.js &
		nohup node NodeJS-Seedlink-Latencies/Latency.js &
		nohup node NodeJS-Seedlink-Server/Seedlink.js &
                ;;
	stop)
		echo "Stopping ORFEUS Manager";
		killall node
		;;
esac

exit 0

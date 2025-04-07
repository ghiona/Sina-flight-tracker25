#!/bin/bash

cd /var/www/flight-tracker

# Kill any existing instances
pkill -f "java -jar target/flight-tracker-1.0-SNAPSHOT.jar"

# Start the flight tracker with our new sample CSV file
java -jar target/flight-tracker-1.0-SNAPSHOT.jar sample-passengers.csv > flight-tracker.log 2>&1 &

# Save the PID to a file for easy shutdown
echo $! > flight-tracker.pid

echo "Flight tracker started with PID $(cat flight-tracker.pid)"
echo "Logs being written to $(pwd)/flight-tracker.log"

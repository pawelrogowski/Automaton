#!/bin/bash

while true; do
    # Get the current mouse position
    mouse_position=$(xdotool getmouselocation)

    # Extract the x and y coordinates from the output using awk
    x_coord=$(echo "$mouse_position" | awk -F"x:" '{print $2}' | awk -F"," '{print $1}')
    y_coord=$(echo "$mouse_position" | awk -F"y:" '{print $2}' | awk -F"," '{print $1}')

    # Log the mouse position to the terminal
    echo "Current mouse position: ($x_coord, $y_coord)"

    # Sleep for a short duration before checking again
    sleep 0.1
done
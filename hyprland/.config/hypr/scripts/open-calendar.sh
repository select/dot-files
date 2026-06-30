#!/bin/bash

# Get the name of the current active workspace
current_ws=$(hyprctl -j activeworkspace | jq -r '.name')

# Spawn or activate gnome-calendar
gnome-calendar &

# Give gnome-calendar window a brief moment to map/activate
sleep 0.12

# Move the GNOME Calendar window to the current workspace and focus it
hyprctl eval "hl.dispatch(hl.dsp.window.move({ workspace = '$current_ws', window = 'class:org.gnome.Calendar', follow = true }))"

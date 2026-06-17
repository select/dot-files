#!/usr/bin/env bash

# Use .bool from getoption because the new Hyprland Lua parser returns .bool instead of .int
on=$(hyprctl -j getoption animations:enabled | jq --raw-output '.bool')

if [[ "$on" == "true" ]]; then	
    hyprctl eval 'hl.config({ animations = { enabled = false }, general = { gaps_in = 0, gaps_out = { top = 0, right = 0, bottom = 4, left = 0 } }, decoration = { rounding = 0 } })'
    notify-send -a hypr "Animations off"
else
    hyprctl eval 'hl.config({ animations = { enabled = true }, general = { gaps_in = 3, gaps_out = 6 }, decoration = { rounding = 10 } })'
    notify-send -a hypr "Animations on"
fi
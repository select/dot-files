#!/usr/bin/env bash

on=$(hyprctl -j getoption animations:enabled | jq --raw-output '.int')

if [[ $on -eq 1 ]]; then	
    hyprctl keyword animations:enabled 0
    hyprctl keyword general:gaps_in 0
    hyprctl keyword general:gaps_out 0
    hyprctl keyword decoration:rounding 0
    notify-send -a hypr "Animations off"
else
    hyprctl keyword animations:enabled 1
    hyprctl keyword general:gaps_in 3
    hyprctl keyword general:gaps_out 6
    hyprctl keyword decoration:rounding 10
    notify-send -a hypr "Animations on"
fi
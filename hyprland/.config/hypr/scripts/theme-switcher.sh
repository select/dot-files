#!/usr/bin/env bash

if [ -z $1 ]; then
    echo "no theme selected"
    # notify-send "no theme selected"
    exit 1
fi
if [ ! -d "$HOME/.config/waybar/themes/$1/" ]; then
    echo "~/.config/waybar/themes/$1/ does not exist."
    exit 1
fi
echo "done"
rm "$HOME/.config/waybar/config"
rm "$HOME/.config/waybar/style.css"
ln -s "$HOME/.config/waybar/themes/$1/config" "$HOME/.config/waybar/config"
ln -s "$HOME/.config/waybar/themes/$1/style.css" "$HOME/.config/waybar/style.css"
killall waybar
sleep 0.5
waybar
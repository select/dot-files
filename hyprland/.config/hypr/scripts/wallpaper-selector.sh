#!/usr/bin/env bash
selected=$(find "$HOME/Pictures/Wallpapers" | egrep '.jpg|.png' | wofi -i -p "Theme" --dmenu --cache-file /dev/null)

echo "you selected $selected"

$HOME/.config/hypr/wallpaper.sh "$selected"

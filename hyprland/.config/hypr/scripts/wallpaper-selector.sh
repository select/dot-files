#!/usr/bin/env bash
selected=$(find "$HOME/Pictures/Wallpaper" -type f | egrep -i '\.(jpg|jpeg|png|webp)$' | wofi -i -p "Wallpaper" --dmenu --cache-file /dev/null)

[ -z "$selected" ] && exit 0

echo "you selected $selected"

"$HOME/.config/hypr/scripts/wallpaper.sh" "$selected"

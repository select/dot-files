#!/usr/bin/env bash
DIR="$HOME/Pictures/Wallpaper"

# show only the bare filename (no path, no extension) in the menu
choice=$(find "$DIR" -maxdepth 1 -type f | egrep -i '\.(jpg|jpeg|png)$' \
	| while read -r f; do b=$(basename "$f"); echo "${b%.*}"; done \
	| sort | wofi -i -p "Wallpaper" --dmenu --cache-file /dev/null)

[ -z "$choice" ] && exit 0

# resolve the chosen display name back to the real file path
selected=$(find "$DIR" -maxdepth 1 -type f | egrep -i '\.(jpg|jpeg|png)$' \
	| while read -r f; do b=$(basename "$f"); [ "${b%.*}" = "$choice" ] && { echo "$f"; break; }; done)

[ -z "$selected" ] && exit 0

echo "you selected $selected"

"$HOME/.config/hypr/scripts/wallpaper.sh" "$selected"

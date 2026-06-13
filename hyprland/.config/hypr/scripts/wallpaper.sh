#!/usr/bin/env bash
if [ -z "$1" ]; then
	exit 1
elif [ "$1" == "random" ]; then
	echo "selecting a random wallpaper"
	~/.local/bin/wal -n -i ~/Pictures/Wallpaper
else
	echo "selected wallpaper $1"
	~/.local/bin/wal -n -i "$1"
fi
sleep 1
cp ~/.cache/wal/colors-waybar.css ~/.config/waybar/colors-waybar.css
image_path=$(cat ~/.cache/wal/wal)
~/.cargo/bin/swww img "$image_path" --transition-type center --resize crop
notify-send -a hypr "Wallpaper changed $image_path"

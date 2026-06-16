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

# Self-heal: the switcher is useless if swww-daemon isn't running, so make sure
# it's up before trying to set the image. Prefer the systemd user service (it
# auto-restarts on crash and logs to the journal); fall back to a bare launch.
if ! ~/.cargo/bin/swww query >/dev/null 2>&1; then
	systemctl --user start swww-daemon.service 2>/dev/null || ~/.cargo/bin/swww-daemon &
	for _ in $(seq 1 50); do
		~/.cargo/bin/swww query >/dev/null 2>&1 && break
		sleep 0.1
	done
fi

~/.cargo/bin/swww img "$image_path" --transition-type center --resize crop
notify-send -a hypr "Wallpaper changed $image_path"

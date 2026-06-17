#!/usr/bin/env bash
# Capture backend for the AGS screenshot/record widget.
# Usage: capture.sh <screenshot|video|stop> [region|screen|window]
# Commands mirror the old wofi capture-menu.sh.

RECORDINGS="$HOME/Videos/Screencasts"
SCREENSHOTS="$HOME/Pictures/Screenshots"
mkdir -p "$RECORDINGS" "$SCREENSHOTS"

GSR="$HOME/.local/bin/gsr"
HYPRSHOT="$HOME/.local/bin/hyprshot"
ADDRECENT="$HOME/.local/bin/add-to-recent"

KIND="$1"
MODE="$2"

# Wait until gpu-screen-recorder has written its first bytes, then notify + update waybar
_wait_and_notify() {
	local file="$1"
	(
		for i in $(seq 1 20); do
			sleep 0.3
			[ -s "$file" ] && break
		done
		notify-send -i media-record "Recording started" "Press Print again to stop"
		pkill -SIGRTMIN+8 waybar
		"$ADDRECENT" "$file"
	) &
}

_stop_recording() {
	pkill -SIGINT -f "[g]pu-screen-recorder"
	notify-send -i media-record "Recording stopped" "Saved to ~/Videos/Screencasts"
	pkill -SIGRTMIN+8 waybar
}

# Let the AGS layer surface fully close before slurp/hyprshot grabs the screen
_settle() { sleep 0.2; }

# Explicit stop, or any video action while a recording is already running, stops it.
if [ "$KIND" = "stop" ]; then
	_stop_recording
	exit 0
fi
if [ "$KIND" = "video" ] && pgrep -f "[g]pu-screen-recorder" > /dev/null; then
	_stop_recording
	exit 0
fi

case "$KIND-$MODE" in
	screenshot-region)
		_settle
		"$HYPRSHOT" -m region -o "$SCREENSHOTS" -- "$ADDRECENT"
		;;
	screenshot-screen)
		_settle
		"$HYPRSHOT" -m output -o "$SCREENSHOTS" -- "$ADDRECENT"
		;;
	screenshot-window)
		_settle
		"$HYPRSHOT" -m window -o "$SCREENSHOTS" -- "$ADDRECENT"
		;;
	video-region)
		_settle
		REGION=$(slurp 2>/dev/null | awk '{split($1,a,","); print $2"+"a[1]"+"a[2]}') || exit 0
		[ -z "$REGION" ] && exit 0
		FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
		"$GSR" -w region -region "$REGION" -f 60 -a default_output \
			-k h264 -o "$FILE" &
		_wait_and_notify "$FILE"
		;;
	video-window)
		_settle
		REGION=$(hyprctl activewindow -j \
			| awk -F'[],[]' '/"at"/{x=$2;y=$3} /"size"/{w=$2;h=$3} END{gsub(/ /,"",x);gsub(/ /,"",y);gsub(/ /,"",w);gsub(/ /,"",h); if(w)print w"x"h"+"x"+"y}')
		[ -z "$REGION" ] && exit 0
		FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
		"$GSR" -w region -region "$REGION" -f 60 -a default_output \
			-k h264 -o "$FILE" &
		_wait_and_notify "$FILE"
		;;
	video-screen)
		FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
		MONITOR=$(hyprctl monitors -j | jq -r '.[] | select(.focused) | .name' 2>/dev/null)
		if [ -n "$MONITOR" ]; then
			"$GSR" -w "$MONITOR" -f 60 -a default_output -k h264 -o "$FILE" &
		else
			"$GSR" -w portal -f 60 -a default_output \
				-restore-portal-session yes -k h264 -o "$FILE" &
		fi
		_wait_and_notify "$FILE"
		;;
esac

#!/usr/bin/env bash
# Capture backend for the AGS screenshot/record widget.
# Usage: capture.sh <screenshot|video|stop> [region|screen|window] [mic|no-mic] [keys|no-keys]
# Commands mirror the old wofi capture-menu.sh.

RECORDINGS="$HOME/Videos/Screencasts"
SCREENSHOTS="$HOME/Pictures/Screenshots"
mkdir -p "$RECORDINGS" "$SCREENSHOTS"

GSR="$HOME/.local/bin/gsr"
HYPRSHOT="$HOME/.local/bin/hyprshot"
ADDRECENT="$HOME/.local/bin/add-to-recent"
WSHOWKEYS=$(command -v wshowkeys 2>/dev/null)
KEYS_PID="${XDG_RUNTIME_DIR:-/tmp}/capture-wshowkeys.pid"

KIND="$1"
MODE="$2"
MIC="$3"
KEYS="$4"

AUDIO_ARGS=(-a default_output)
if [ "$MIC" = "mic" ]; then
	# Combine desktop and microphone audio into one track for normal playback.
	AUDIO_ARGS=(-a "default_output|default_input")
fi

# Wait until gpu-screen-recorder has written its first bytes, then notify + update waybar
_wait_and_notify() {
	local file="$1"
	local recorder_pid="$2"
	(
		for i in $(seq 1 20); do
			sleep 0.3
			[ -s "$file" ] && break
		done
		notify-send -i media-record "Recording started" "Press Print again to stop"
		pkill -SIGRTMIN+8 waybar
		"$ADDRECENT" "$file"

		# Also clean up the overlay when the recorder exits outside this UI.
		while kill -0 "$recorder_pid" 2>/dev/null; do
			sleep 0.5
		done
		_stop_key_overlay
	) &
}

_start_key_overlay() {
	[ "$KEYS" = "keys" ] || return
	local region="${1:-}"
	local args=(-F "Sans Bold 28" -t 1000)

	if [ -z "$WSHOWKEYS" ]; then
		notify-send -u critical "Key overlay unavailable" "wshowkeys was not found"
		return
	fi

	# Leave a wshowkeys instance started outside this capture UI untouched.
	pgrep -x wshowkeys > /dev/null && return

	if [[ "$region" =~ ^([0-9]+)x([0-9]+)\+(-?[0-9]+)\+(-?[0-9]+)$ ]]; then
		local width=${BASH_REMATCH[1]}
		local height=${BASH_REMATCH[2]}
		local x=${BASH_REMATCH[3]}
		local y=${BASH_REMATCH[4]}
		local monitor
		local monitor_x=0
		local monitor_y=0

		monitor=$(hyprctl monitors -j | jq -r --argjson x "$x" --argjson y "$y" '
			.[] | select(
				$x >= .x and $x < (.x + (.width / .scale)) and
				$y >= .y and $y < (.y + (.height / .scale))
			) | "\(.x) \(.y)"' | head -n1)
		if [ -n "$monitor" ]; then
			read -r monitor_x monitor_y <<< "$monitor"
		fi

		# Keep the overlay inside the recording, aligned to its bottom-left edge.
		local left=$((x - monitor_x + 12))
		local top=$((y - monitor_y + height - 58))
		local limit=$((width - 24))
		((top < y - monitor_y)) && top=$((y - monitor_y))
		((limit < 100)) && limit=100
		args+=(-a top -a left -x "$left" -y "$top" -l "$limit")
	else
		args+=(-a bottom -m 80 -l 800)
	fi

	"$WSHOWKEYS" "${args[@]}" &
	echo $! > "$KEYS_PID"
	sleep 0.2
}

_stop_key_overlay() {
	[ -f "$KEYS_PID" ] || return
	local pid
	pid=$(cat "$KEYS_PID")
	if [ "$(ps -o comm= -p "$pid" 2>/dev/null)" = "wshowkeys" ]; then
		kill "$pid" 2>/dev/null || true
	fi
	rm -f "$KEYS_PID"
}

_stop_recording() {
	pkill -SIGINT -f "[g]pu-screen-recorder"
	_stop_key_overlay
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
		_start_key_overlay "$REGION"
		"$GSR" -w region -region "$REGION" -f 60 "${AUDIO_ARGS[@]}" \
			-k h264 -o "$FILE" &
		_wait_and_notify "$FILE" "$!"
		;;
	video-window)
		_settle
		REGION=$(hyprctl activewindow -j \
			| awk -F'[],[]' '/"at"/{x=$2;y=$3} /"size"/{w=$2;h=$3} END{gsub(/ /,"",x);gsub(/ /,"",y);gsub(/ /,"",w);gsub(/ /,"",h); if(w)print w"x"h"+"x"+"y}')
		[ -z "$REGION" ] && exit 0
		FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
		_start_key_overlay "$REGION"
		"$GSR" -w region -region "$REGION" -f 60 "${AUDIO_ARGS[@]}" \
			-k h264 -o "$FILE" &
		_wait_and_notify "$FILE" "$!"
		;;
	video-screen)
		FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
		_start_key_overlay
		MONITOR=$(hyprctl monitors -j | jq -r '.[] | select(.focused) | .name' 2>/dev/null)
		if [ -n "$MONITOR" ]; then
			"$GSR" -w "$MONITOR" -f 60 "${AUDIO_ARGS[@]}" -k h264 -o "$FILE" &
		else
			"$GSR" -w portal -f 60 "${AUDIO_ARGS[@]}" \
				-restore-portal-session yes -k h264 -o "$FILE" &
		fi
		_wait_and_notify "$FILE" "$!"
		;;
esac

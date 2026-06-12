#!/usr/bin/env bash

RECORDINGS="$HOME/Videos/Screencasts"
SCREENSHOTS="$HOME/Pictures"
mkdir -p "$RECORDINGS"

GSR="$HOME/.local/bin/gsr"

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
    ) &
}

# ── Build menu depending on whether a recording is already running ──────────
if pgrep -f "gpu-screen-recorder" > /dev/null; then
    entries="󰭖  Stop Recording\n󰕨  Screenshot  ·  Full Screen\n󰇵  Screenshot  ·  Region"
    height=165
else
    entries="󰕨  Screenshot  ·  Full Screen\n󰇵  Screenshot  ·  Region\n󰭓  Record  ·  Full Screen\n󰒚  Record  ·  Region"
    height=210
fi

selected=$(echo -e "$entries" \
    | wofi --width 310 --height $height -i -p "Capture" --dmenu --cache-file /dev/null)

case "$selected" in
    *"Stop"*)
        pkill -SIGINT -f "gpu-screen-recorder"
        notify-send -i media-record "Recording stopped" "Saved to ~/Videos/Screencasts"
        pkill -SIGRTMIN+8 waybar
        ;;
    *"Screenshot"*"Full"*)
        hyprshot -m output -o "$SCREENSHOTS"
        ;;
    *"Screenshot"*"Region"*)
        hyprshot -m region -o "$SCREENSHOTS"
        ;;
    *"Record"*"Full"*)
        FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
        "$GSR" -w portal -f 60 -a default_output \
               -restore-portal-session yes -k h264 -o "$FILE" &
        _wait_and_notify "$FILE"
        ;;
    *"Record"*"Region"*)
        FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
        "$GSR" -w region -f 60 -a default_output \
               -k h264 -o "$FILE" &
        _wait_and_notify "$FILE"
        ;;
esac

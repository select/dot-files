#!/usr/bin/env bash

RECORDINGS="$HOME/Videos/Screencasts"
SCREENSHOTS="$HOME/Pictures"
mkdir -p "$RECORDINGS"

# ── Build menu depending on whether a recording is already running ──────────
if pgrep -x wf-recorder > /dev/null; then
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
        pkill -INT wf-recorder
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
        notify-send -i media-record "Recording started" "Press Print again to stop"
        wf-recorder -f "$FILE" &
        sleep 0.5 && pkill -SIGRTMIN+8 waybar &
        ;;
    *"Record"*"Region"*)
        AREA=$(slurp 2>/dev/null) || exit 0
        FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
        notify-send -i media-record "Recording region" "Press Print again to stop"
        wf-recorder -g "$AREA" -f "$FILE" &
        sleep 0.5 && pkill -SIGRTMIN+8 waybar &
        ;;
esac

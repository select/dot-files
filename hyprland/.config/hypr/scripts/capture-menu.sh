#!/usr/bin/env bash

RECORDINGS="$HOME/Videos/Screencasts"
SCREENSHOTS="$HOME/Pictures"
mkdir -p "$RECORDINGS"

GSR="$HOME/.local/bin/gsr"
HYPRSHOT="$HOME/.local/bin/hyprshot"

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
    entries="󰭖  Stop Recording\n󰇵  Screenshot  ·  Region\n󰕨  Screenshot  ·  Full Screen"
    height=165
else
    entries="󰇵  Screenshot  ·  Region\n󰕨  Screenshot  ·  Full Screen\n󰒚  Record  ·  Region\n󰭓  Record  ·  Full Screen"
    height=210
fi

selected=$(echo -e "$entries" \
    | wofi --width 310 --height $height -i -p "Capture" --dmenu --cache-file /dev/null)

# Let wofi's layer surface fully close before slurp/hyprshot grabs the screen
_settle() { sleep 0.2; }

case "$selected" in
    *"Stop"*)
        pkill -SIGINT -f "gpu-screen-recorder"
        notify-send -i media-record "Recording stopped" "Saved to ~/Videos/Screencasts"
        pkill -SIGRTMIN+8 waybar
        ;;
    *"Screenshot"*"Region"*)
        _settle
        "$HYPRSHOT" -m region -o "$SCREENSHOTS"
        ;;
    *"Screenshot"*"Full"*)
        _settle
        "$HYPRSHOT" -m output -o "$SCREENSHOTS"
        ;;
    *"Record"*"Region"*)
        _settle
        REGION=$(slurp 2>/dev/null | awk '{split($1,a,","); print $2"+"a[1]"+"a[2]}') || exit 0
        [ -z "$REGION" ] && exit 0
        FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
        "$GSR" -w region -region "$REGION" -f 60 -a default_output \
               -k h264 -o "$FILE" &
        _wait_and_notify "$FILE"
        ;;
    *"Record"*"Full"*)
        FILE="$RECORDINGS/$(date +%Y-%m-%d_%H-%M-%S).mp4"
        "$GSR" -w portal -f 60 -a default_output \
               -restore-portal-session yes -k h264 -o "$FILE" &
        _wait_and_notify "$FILE"
        ;;
esac

#!/usr/bin/env bash
# Outputs JSON for waybar custom/recorder — empty when idle (module auto-hides)
if pgrep -f "gpu-screen-recorder" > /dev/null; then
    printf '{"text":"\u25cf","tooltip":"Recording · Click to stop","class":"active"}\n'
fi

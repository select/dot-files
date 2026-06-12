#!/usr/bin/env bash
# Outputs JSON for waybar custom/recorder — empty when idle (module auto-hides)
if pgrep -x wf-recorder > /dev/null; then
    printf '{"text":"\U000f0b53","tooltip":"Recording · Click to stop","class":"active"}\n'
fi

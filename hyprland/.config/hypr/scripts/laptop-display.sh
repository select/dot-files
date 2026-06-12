#!/usr/bin/env bash
# Manage the laptop screen (eDP-1) as a TRUE enable/disable (not DPMS).
#
# State is the user preference in ~/.config/hypr/state/laptop-on ("1"=on, "0"=off).
# The actual disabled/enabled decision lives in hyprland.lua, which also force-enables
# eDP-1 whenever the Samsung (DP-2) is unplugged. We just flip the pref and reload.
#
# Usage: laptop-display.sh [toggle|on|off]   (default: toggle)
set -euo pipefail

STATE="$HOME/.config/hypr/state/laptop-on"
mkdir -p "$(dirname "$STATE")"
[ -f "$STATE" ] || echo "0" > "$STATE"

cur=$(tr -d '[:space:]' < "$STATE")
action="${1:-toggle}"

case "$action" in
    on)     new=1 ;;
    off)    new=0 ;;
    toggle) [ "$cur" = "1" ] && new=0 || new=1 ;;
    *) echo "usage: $0 [toggle|on|off]" >&2; exit 1 ;;
esac

echo "$new" > "$STATE"
hyprctl reload >/dev/null

if [ "$new" = "1" ]; then
    notify-send "Laptop screen" "Enabled" 2>/dev/null || true
else
    notify-send "Laptop screen" "Disabled" 2>/dev/null || true
fi

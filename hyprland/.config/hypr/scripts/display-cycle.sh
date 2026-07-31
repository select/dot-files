#!/usr/bin/env bash
# Cycle the display configuration between three modes:
#
#   laptop   -> only the laptop screen (eDP-1) is on, external (DP-2) off
#   both     -> laptop + external both on
#   external -> only the external monitor (DP-2) is on, laptop off
#
# The mode preference is stored in ~/.config/hypr/state/display-mode.
# The actual enabled/disabled decision lives in hyprland.lua, which reads
# this file and also falls back to "laptop" whenever DP-2 is unplugged.
# We just advance the preference and `hyprctl reload`.
#
# Usage: display-cycle.sh [cycle|laptop|both|external]   (default: cycle)
set -euo pipefail

STATE="$HOME/.config/hypr/state/display-mode"
mkdir -p "$(dirname "$STATE")"
[ -f "$STATE" ] || echo "both" > "$STATE"

cur=$(tr -d '[:space:]' < "$STATE")
action="${1:-cycle}"

# A monitor is "connected" if Hyprland lists it (even when disabled).
# Disconnected outputs do not appear in `hyprctl monitors all`.
connected() { hyprctl -j monitors all 2>/dev/null | grep -q "\"name\": \"$1\""; }
laptop_connected()   { connected "eDP-1"; }
# External may be DisplayPort or HDMI depending on cable/dock.
external_connected() { connected "DP-2" || connected "HDMI-A-1"; }

# Is a target mode safe (leaves at least one real screen on)?
mode_ok() {
    case "$1" in
        laptop)   laptop_connected ;;
        external) external_connected ;;
        both)     laptop_connected || external_connected ;;
        *)        return 1 ;;
    esac
}

next_mode() {
    case "$1" in
        laptop)   echo both ;;
        both)     echo external ;;
        external) echo laptop ;;
        *)        echo both ;;
    esac
}

case "$action" in
    laptop|both|external)
        new="$action"
        if ! mode_ok "$new"; then
            notify-send "Display" "'$new' not possible (required screen not connected)" 2>/dev/null || true
            exit 0
        fi
        ;;
    cycle)
        # Advance to the next mode, skipping any that would leave 0 screens.
        new=$(next_mode "$cur")
        for _ in 1 2 3; do
            mode_ok "$new" && break
            new=$(next_mode "$new")
        done
        # Absolute fallback: if somehow nothing is OK, keep the laptop on.
        mode_ok "$new" || new=laptop
        ;;
    *) echo "usage: $0 [cycle|laptop|both|external]" >&2; exit 1 ;;
esac

echo "$new" > "$STATE"
hyprctl reload >/dev/null

case "$new" in
    laptop)   msg="Laptop only" ;;
    both)     msg="Laptop + External" ;;
    external) msg="External only" ;;
esac
notify-send "Display" "$msg" 2>/dev/null || true

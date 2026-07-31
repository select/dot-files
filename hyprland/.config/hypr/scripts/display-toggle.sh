#!/usr/bin/env bash
# Toggle the display configuration between two modes only:
#
#   laptop   -> only the laptop screen (eDP-1) is on, external (DP-2) off
#   external -> only the external monitor (DP-2) is on, laptop off
#
# Unlike display-cycle.sh this never enables the "both" mode; it flips
# straight between laptop-only and external-only.
#
# The mode preference is stored in ~/.config/hypr/state/display-mode
# (the same file display-cycle.sh uses). hyprland.lua reads this file and
# also falls back to "laptop" whenever DP-2 is unplugged. We just write the
# preference and `hyprctl reload`.
#
# Usage: display-toggle.sh [toggle|laptop|external]   (default: toggle)
set -euo pipefail

STATE="$HOME/.config/hypr/state/display-mode"
mkdir -p "$(dirname "$STATE")"
[ -f "$STATE" ] || echo "laptop" > "$STATE"

cur=$(tr -d '[:space:]' < "$STATE")
action="${1:-toggle}"

# A monitor is "connected" if Hyprland lists it (even when disabled).
# Disconnected outputs do not appear in `hyprctl monitors all`.
connected() { hyprctl -j monitors all 2>/dev/null | grep -q "\"name\": \"$1\""; }
laptop_connected()   { connected "eDP-1"; }
# External may be DisplayPort or HDMI depending on cable/dock.
external_connected() { connected "DP-2" || connected "HDMI-A-1"; }

# Is a target mode safe (the required screen is actually connected)?
mode_ok() {
    case "$1" in
        laptop)   laptop_connected ;;
        external) external_connected ;;
        *)        return 1 ;;
    esac
}

case "$action" in
    laptop|external)
        new="$action"
        ;;
    toggle)
        # Flip to the opposite of whatever we're on. Treat "both" (or any
        # unknown value) as if we're on laptop, so we move to external.
        case "$cur" in
            external) new=laptop ;;
            *)        new=external ;;
        esac
        ;;
    *) echo "usage: $0 [toggle|laptop|external]" >&2; exit 1 ;;
esac

if ! mode_ok "$new"; then
    notify-send "Display" "'$new' not possible (required screen not connected)" 2>/dev/null || true
    exit 0
fi

echo "$new" > "$STATE"
hyprctl reload >/dev/null

case "$new" in
    laptop)   msg="Laptop only" ;;
    external) msg="External only" ;;
esac
notify-send "Display" "$msg" 2>/dev/null || true

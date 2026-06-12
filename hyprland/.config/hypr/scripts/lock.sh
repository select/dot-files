#!/usr/bin/env bash
# Safe lock wrapper.
#
# Locking while only ONE monitor is enabled can drop Hyprland to zero usable
# monitors during the DRM modeset and crash the whole session (enterUnsafeState
# null-deref). To avoid that we make sure the laptop panel (eDP-1) is enabled
# *before* locking, then restore the previous state after unlocking.
set -uo pipefail

STATE="$HOME/.config/hypr/state/laptop-on"
mkdir -p "$(dirname "$STATE")"
prev=$(tr -d '[:space:]' < "$STATE" 2>/dev/null || echo 0)

# Seconds the lock screen stays lit before the displays power off (DPMS).
# Any key press or mouse move wakes them again (misc:*_enables_dpms = true).
BLANK_AFTER=15

restore() {
    # Make sure displays are powered back on, then restore the laptop state.
    hyprctl dispatch 'hl.dsp.dpms({"on"})' >/dev/null 2>&1
    if [ "$prev" != "1" ]; then
        echo "$prev" > "$STATE"
        hyprctl reload >/dev/null 2>&1
    fi
}
trap restore EXIT

# Ensure laptop is on so we never lock on a single monitor.
if [ "$prev" != "1" ]; then
    echo 1 > "$STATE"
    hyprctl reload >/dev/null 2>&1
    sleep 0.4   # let the monitor settle before the lock modeset
fi

# After BLANK_AFTER seconds, power the displays off (in the background).
( sleep "$BLANK_AFTER"; hyprctl dispatch 'hl.dsp.dpms({"off"})' >/dev/null 2>&1 ) &
BLANKER=$!

# Block here until the user unlocks; restore() runs on exit.
hyprlock
kill "$BLANKER" 2>/dev/null

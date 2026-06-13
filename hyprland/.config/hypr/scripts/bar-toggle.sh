#!/usr/bin/env bash
# Toggle between Waybar and the custom AGS bar (mutually exclusive).
# The AGS process keeps running either way (it also serves the power menu);
# only its "bar" window is shown/hidden. Waybar is started/stopped.

state="${XDG_RUNTIME_DIR:-/tmp}/active-bar"
current="$(cat "$state" 2>/dev/null || echo ags)"

if [ "$current" = "ags" ]; then
	# switch to Waybar
	ags toggle bar 2>/dev/null            # hide AGS bar
	cp -n ~/.cache/wal/colors-waybar.css ~/.config/waybar/colors-waybar.css 2>/dev/null
	pgrep -x waybar >/dev/null || waybar >/dev/null 2>&1 &
	echo waybar >"$state"
else
	# switch to AGS bar
	pkill -x waybar 2>/dev/null
	ags toggle bar 2>/dev/null            # show AGS bar
	echo ags >"$state"
fi

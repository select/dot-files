#!/usr/bin/env bash
# Cycle through hypr-dynamic-cursors "dynamic mouse effects" and report status
# to Waybar. Persists the choice so it survives `hyprctl reload`.
#
# Usage:
#   cursor-effect.sh status   # print Waybar JSON for the current mode
#   cursor-effect.sh next     # advance to the next mode, apply it, refresh bar

STATE_FILE="$HOME/.config/hypr/state/cursor-mode"

# Order of the cycle.
MODES=(none tilt rotate stretch)

# Per-mode display: icon + human label.
declare -A ICON=(
	[none]="󰳽"
	[tilt]="󰳽"
	[rotate]="󰳽"
	[stretch]="󰳽"
)
declare -A LABEL=(
	[none]="None"
	[tilt]="Tilt"
	[rotate]="Rotate"
	[stretch]="Stretch"
)

current_mode() {
	local m
	m="$(cat "$STATE_FILE" 2>/dev/null)"
	case " ${MODES[*]} " in
	*" $m "*) echo "$m" ;;
	*) echo "stretch" ;; # default matches hyprland.lua
	esac
}

apply_mode() {
	local mode="$1"
	mkdir -p "$(dirname "$STATE_FILE")"
	echo "$mode" >"$STATE_FILE"
	# The Lua parser rejects `hyprctl keyword`, so re-read config (hyprland.lua
	# loads the mode from $STATE_FILE). config-only avoids a monitor reload.
	hyprctl reload config-only >/dev/null 2>&1
}

print_status() {
	local mode="$1"
	printf '{"text": "%s", "tooltip": "Mouse effect: %s\\nClick to cycle", "class": "%s", "alt": "%s"}\n' \
		"${ICON[$mode]}" "${LABEL[$mode]}" "$mode" "$mode"
}

cmd="${1:-status}"

case "$cmd" in
status)
	print_status "$(current_mode)"
	;;
next)
	cur="$(current_mode)"
	idx=0
	for i in "${!MODES[@]}"; do
		[ "${MODES[$i]}" = "$cur" ] && idx="$i"
	done
	next_idx=$(((idx + 1) % ${#MODES[@]}))
	next_mode="${MODES[$next_idx]}"
	apply_mode "$next_mode"
	notify-send -i input-mouse "Mouse effect" "${LABEL[$next_mode]}" -t 1200 2>/dev/null
	pkill -SIGRTMIN+9 waybar 2>/dev/null
	;;
*)
	echo "usage: $0 {status|next}" >&2
	exit 1
	;;
esac

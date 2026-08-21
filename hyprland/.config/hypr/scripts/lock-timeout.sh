#!/usr/bin/env bash
# Read or update the inactivity timeout used by hypridle.
# Usage: lock-timeout.sh {get|set MINUTES|next}
set -euo pipefail

CONFIG="$HOME/.config/hypr/hypridle.conf"
VALUES=(5 10 15 30 45 60)

current_minutes() {
	awk '
		/# Lock the screen after/ { in_lock = 1; next }
		in_lock && /^[[:space:]]*timeout[[:space:]]*=/ {
			line = $0
			sub(/^[^=]*=[[:space:]]*/, "", line)
			print int(line / 60)
			exit
		}
	' "$CONFIG"
}

set_minutes() {
	local minutes="$1"
	local seconds=$((minutes * 60))
	local tmp
	tmp=$(mktemp)

	awk -v minutes="$minutes" -v seconds="$seconds" '
		/# Lock the screen after/ {
			print "# Lock the screen after " minutes " minutes of inactivity."
			in_lock = 1
			next
		}
		in_lock && /^[[:space:]]*timeout[[:space:]]*=/ {
			sub(/=.*/, "= " seconds)
			in_lock = 0
		}
		{ print }
	' "$CONFIG" > "$tmp"
	mv "$tmp" "$CONFIG"

	# hypridle only reads its configuration on startup.
	pkill -x hypridle 2>/dev/null || true
	nohup hypridle >/dev/null 2>&1 &
	notify-send -a hypr "Screen lock" "Locks after $minutes minutes" -t 1200 2>/dev/null || true
}

case "${1:-get}" in
	get)
		current_minutes
		;;
	set)
		minutes="${2:-}"
		[[ "$minutes" =~ ^[1-9][0-9]*$ ]] && (( minutes <= 1440 )) || {
			echo "usage: $0 {get|set MINUTES|next}" >&2
			exit 1
		}
		set_minutes "$minutes"
		;;
	next)
		current=$(current_minutes)
		next="${VALUES[0]}"
		for i in "${!VALUES[@]}"; do
			if [[ "${VALUES[$i]}" == "$current" ]]; then
				next="${VALUES[$(((i + 1) % ${#VALUES[@]}))]}"
				break
			fi
		done
		set_minutes "$next"
		;;
	*)
		echo "usage: $0 {get|set MINUTES|next}" >&2
		exit 1
		;;
esac

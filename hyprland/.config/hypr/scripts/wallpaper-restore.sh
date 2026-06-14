#!/usr/bin/env bash
# Restore the last wallpaper selected via pywal on startup.
# pywal writes the chosen image path to ~/.cache/wal/wal.
wal_file="$HOME/.cache/wal/wal"
[ -f "$wal_file" ] || exit 0
image_path=$(cat "$wal_file")
[ -f "$image_path" ] || exit 0

# Wait for swww-daemon to be ready before setting the image.
for _ in $(seq 1 50); do
	if ~/.cargo/bin/swww query >/dev/null 2>&1; then
		break
	fi
	sleep 0.1
done

~/.cargo/bin/swww img "$image_path" --transition-type center --resize crop

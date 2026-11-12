#!/usr/bin/env bash
# hyprshot post-capture command: annotate the saved PNG, then add it to recents.
# hyprshot has already copied the original to the clipboard; saving in the editor
# overwrites the file and copies the annotated image instead.
set -u
FILE="${1:-}"
[ -f "$FILE" ] || exit 0
DIR="$(dirname "$(readlink -f "$0")")"
"$DIR/screenshot-annotate.py" "$FILE" ||
	notify-send -u critical "Screenshot editor failed" "The original screenshot was kept: $FILE"
"$HOME/.local/bin/add-to-recent" "$FILE"

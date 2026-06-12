#!/usr/bin/env bash
# Toggle xkb layout for ALL keyboards at once.
# Hyprland tracks layout per-keyboard, so switching only one leaves the
# others (e.g. the keyboard you actually type on) on the old layout.

# Determine the target index from the laptop's built-in keyboard, then flip it.
current=$(hyprctl devices -j | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in d.get('keyboards',[]):
    if k['name']=='at-translated-set-2-keyboard':
        print(k.get('active_keymap','')); break
")

# us,de -> if currently English, go to index 1 (de); else index 0 (us)
case "$current" in
    English*) target=1 ;;
    *)        target=0 ;;
esac

# Apply to every keyboard
hyprctl devices -j | python3 -c "
import json,sys
d=json.load(sys.stdin)
for k in d.get('keyboards',[]):
    print(k['name'])
" | while read -r kb; do
    hyprctl switchxkblayout "$kb" "$target" >/dev/null
done

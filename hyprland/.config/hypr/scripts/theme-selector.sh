#!/usr/bin/env bash
entries=`ls -1 $HOME/.config/waybar/themes/`

echo -e $entries
selected=$(printf '%s\n' $entries | wofi -i -p "Theme" --dmenu --cache-file /dev/null)

echo "you selected $selected"

$HOME/.config/hypr/theme-switcher.sh $selected

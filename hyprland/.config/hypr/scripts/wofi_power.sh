#!/usr/bin/env bash
entries="🔒 Lock\n🚪 Logout\n🌙 Suspend\n⚡ Reboot\n🔌 Shutdown"

selected=$(echo -e $entries|wofi --width 250 --height 210 -i -p "Power" --dmenu --cache-file /dev/null | awk '{print tolower($2)}')

case $selected in
  lock)
    exec ~/.config/hypr/scripts/lock.sh;;
  logout)
    hyprctl dispatch exit;;
  suspend)
    exec systemctl suspend;;
  reboot)
    exec systemctl reboot;;
  shutdown)
    exec systemctl poweroff -i;;
esac
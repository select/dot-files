#!/usr/bin/env bash
# create ~/.conf/mpv.conf
# ```
# input-ipc-server=/tmp/mpvsocket
# ```
# get the video size from mpv
wv=`echo '{ "command": ["get_property", "width"] }' | socat - /tmp/mpvsocket | jq ".data"`
hv=`echo '{ "command": ["get_property", "height"] }' | socat - /tmp/mpvsocket | jq ".data"`

w=$(($wv/4))
h=$(($hv/4))

# get the mpv window size from hyprland
ww=`hyprctl clients -j | jq -c '.[] | select(.class | contains("mpv")) | .size[0]'`
hw=`hyprctl clients -j | jq -c '.[] | select(.class | contains("mpv")) | .size[1]'`


monitor_width=`hyprctl monitors -j | jq -c '.[0].width'`
monitor_scale=`hyprctl monitors -j | jq -c '.[0].scale'`
width_third=`echo "$monitor_width/$monitor_scale/3" | bc`
ratio=`echo "$h/$w" | bc -l`
height_third=`echo "scale=0;$width_third*$ratio" | bc | xargs printf "%.0f"`


# calculate the resize
# wo=$(($w-$ww))
# ho=$(($h-$hw))
wo=$(($width_third-$ww))
ho=$(($height_third-$hw))

echo "3rd $width_third $height_third $ratio"
echo "move $wo $ho"

# resize the window and lock the aspect ratio for resizing
hyprctl dispatch "resizewindowpixel $wo $ho,^(mpv)$"
hyprctl keyword "windowrulev2 keepaspectratio,class:(mpv)"


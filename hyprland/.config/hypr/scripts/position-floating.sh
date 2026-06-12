#!/usr/bin/env bash
# get the monitor size with resizing
wm=`hyprctl monitors -j | jq -c '.[0].width'`
hm=`hyprctl monitors -j | jq -c '.[0].height'`
scale=`hyprctl monitors -j | jq -c '.[0].scale'`
# scaled monitor pixels
wms=`echo "$wm / $scale" | bc` # width monitor scaled
hms=`echo "$hm / $scale" | bc`

# number of floating windows
num=`hyprctl clients -j | jq 'map(select(.floating == true)) | length'`
if (( $num < 1 )); then
    echo 'not enough floating windows'
    exit 1
fi

echo "Num floating: $num"

# get the window position
x=`hyprctl clients -j | jq -c '.[] | select(.floating == true).at[0]'`
y=`hyprctl clients -j | jq -c '.[] | select(.floating == true).at[1]'`

# get the mpv window size from hyprland
ww=`hyprctl clients -j | jq -c '.[] | select(.floating == true) | .size[0]'`
hw=`hyprctl clients -j | jq -c '.[] | select(.floating == true) | .size[1]'`


waybarHeight=`hyprctl layers -j | jq -c '."eDP-1".levels."2"[0].h'`


gapsOut=`hyprctl -j getoption general:gaps_out | jq -r -c '.custom'`
gap=(${gapsOut//;/ })

echo $gap

# top left
xtl=$(($gap-$x))
ytl=$(($gap-$y))
# top right
xtr=$(($wms-$ww-$x-$gap))
ytr=$(($gap-$y))
# bottom right
xbr=$(($wms-$ww-$x-$gap))
ybr=$(($hms-$hw-$y-$gap-$waybarHeight))
# bottom left
xbl=$(($gap-$x))
ybl=$(($hms-$hw-$y-$gap-$waybarHeight))


case $1 in
  tl)
    hyprctl dispatch "movewindowpixel $xtl $ytl,^(mpv)$";;
  tr)
    hyprctl dispatch "movewindowpixel $xtr $ytr,^(mpv)$";;
  br)
    hyprctl dispatch "movewindowpixel $xbr $ybr,^(mpv)$";;
  bl)
    hyprctl dispatch "movewindowpixel $xbl $ybl,^(mpv)$";;
  t)
    hyprctl dispatch "movewindowpixel 0 $ytl,^(mpv)$";;
  r)
    hyprctl dispatch "movewindowpixel $xtr 0,^(mpv)$";;
  b)
    hyprctl dispatch "movewindowpixel 0 $ybr,^(mpv)$";;
  l)
    hyprctl dispatch "movewindowpixel $xbl 0,^(mpv)$";;
esac

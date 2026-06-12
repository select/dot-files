-------------------
---- AUTOSTART ----
-------------------
-- See https://wiki.hypr.land/Configuring/Basics/Autostart/
-- hyprland.start fires once on launch (equivalent to the old `exec-once`).

hl.on("hyprland.start", function()
    -- Status bar (ensure pywal colors file exists first, or waybar's CSS import fails)
    hl.exec_cmd("cp -n ~/.cache/wal/colors-waybar.css ~/.config/waybar/colors-waybar.css 2>/dev/null; waybar")
    -- Notification daemon
    hl.exec_cmd("swaync")
    -- Wallpaper daemon
    hl.exec_cmd("swww-daemon")
    -- Nextcloud sync
    hl.exec_cmd("nextcloud")
    -- Polkit authentication agent (Hyprland-native)
    hl.exec_cmd("systemctl --user start hyprpolkitagent.service")
    -- Idle / lock management (hypridle reads ~/.config/hypr/hypridle.conf)
    hl.exec_cmd("hypridle")
    -- Network manager applet
    hl.exec_cmd("nm-applet --indicator")
    -- Bluetooth manager applet
    hl.exec_cmd("blueman-applet")
    -- Clipboard history
    hl.exec_cmd("wl-paste --watch cliphist store")
    -- pyprland
    hl.exec_cmd("~/.local/bin/pypr")
end)

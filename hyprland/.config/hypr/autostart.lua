-------------------
---- AUTOSTART ----
-------------------
-- See https://wiki.hypr.land/Configuring/Basics/Autostart/
-- hyprland.start fires once on launch (equivalent to the old `exec-once`).

hl.on("hyprland.start", function()
    -- Load enabled hyprpm plugins (e.g. dynamic-cursors) on startup.
    -- Must run first so the plugin drives the forced software cursor
    -- (no_hardware_cursors = true) instead of it freezing mid-screen.
    hl.exec_cmd("hyprpm reload -n")
    -- Status bar: the custom AGS bar (Astal/GTK4) is the default active bar and
    -- also provides the SUPER+SHIFT+X power menu. Toggle to Waybar with SUPER+SHIFT+B.
    -- (ensure pywal colors exist so Waybar's CSS import works when toggled on)
    hl.exec_cmd("cp -n ~/.cache/wal/colors-waybar.css ~/.config/waybar/colors-waybar.css 2>/dev/null")
    hl.exec_cmd("echo ags > \"${XDG_RUNTIME_DIR:-/tmp}/active-bar\"")
    hl.exec_cmd("ags run ~/.config/ags")
    -- Notification daemon
    hl.exec_cmd("swaync")
    -- Wallpaper daemon (swww lives in ~/.cargo/bin, not on Hyprland's PATH)
    hl.exec_cmd(os.getenv("HOME") .. "/.cargo/bin/swww-daemon")
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

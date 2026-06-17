-------------------
---- AUTOSTART ----
-------------------
-- See https://wiki.hypr.land/Configuring/Basics/Autostart/
-- hyprland.start fires once on launch (equivalent to the old `exec-once`).

hl.on("hyprland.start", function()
    -- Push XDG_SESSION_TYPE into the systemd/dbus activation environment so
    -- dbus-activated launches (e.g. Zoom via the zoommtg:// URL handler) inherit
    -- it. Without this Zoom reports isNativeWayland=0 and the screen-share
    -- portal picker never opens.
    hl.exec_cmd("dbus-update-activation-environment --systemd XDG_SESSION_TYPE")
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
    -- Wallpaper daemon (swww lives in ~/.cargo/bin, not on Hyprland's PATH).
    -- Run it as a systemd user service so it auto-restarts on crash and logs to
    -- the journal (journalctl --user -u swww-daemon). The service's
    -- ExecStartPost restores the last pywal-selected wallpaper.
    hl.exec_cmd("systemctl --user start swww-daemon.service")
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
    -- anacron: catch-up scheduler for the daily music sync job
    -- (Hyprland does not read ~/.config/autostart/*.desktop, so launch it here)
    hl.exec_cmd("anacron -s -t " .. os.getenv("HOME") .. "/.anacron/anacrontab -S " .. os.getenv("HOME") .. "/.anacron/timestamps")
end)

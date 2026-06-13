# AGS Bar

A custom Hyprland top bar built with [AGS v3](https://aylur.github.io/ags/) (Astal + GTK4).

## Layout

- **Left** — power-menu trigger (Hyprland logo) + workspace switcher (pill dots)
- **Center** — clock (`HH:MM`)
- **Right** — mic, volume, bluetooth, wifi, notifications, battery

Colors are pulled live from `~/.cache/wal/colors.json` and hot-reload when wal
regenerates them.

## Install (Ubuntu — build from source)

AGS is not packaged for Ubuntu. One script does everything (needs `sudo` for
apt + `meson install`):

```bash
bash ~/.config/ags/install.sh
```

This installs the build deps, builds the Astal libraries + AGS CLI from source,
and prints the `GI_TYPELIB_PATH` note. That env var is already wired into
`zsh/.zshrc` and `hyprland/.config/hypr/hyprland.lua`.

Verify: `ags --version`

## Run

```bash
ags run ~/.config/ags          # foreground (shows logs)
ags inspect                    # GTK inspector for CSS debugging
```

## Autostart (Hyprland)

Add to your Hyprland config (currently Waybar is still active — disable it first):

```
exec-once = ags run
```

## Power menu

Click the logo. Esc closes it. Actions: lock (`hyprlock`), logout, reboot, shutdown.

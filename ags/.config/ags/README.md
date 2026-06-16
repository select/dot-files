# AGS Shell

A custom Hyprland desktop shell built with [AGS v3](https://aylur.github.io/ags/)
(Astal + GTK4). Colors are pulled live from `~/.cache/wal/colors.json` and
hot-reload when wal regenerates them.

## Widgets

| Widget | Description | Toggle |
| ------ | ----------- | ------ |
| [Bar](widget/bar/) | Bottom panel: workspaces, clock, system status | always on |
| [Bluetooth](widget/bluetooth/) | Bluetooth adapter and paired/available devices list | click bluetooth icon |
| [Wi-Fi](widget/wifi/) | Wi-Fi networks discovery, selection and connection | click wi-fi icon |
| [Media](widget/media/) | MPRIS player (title + controls), between bar and tray | when playing |
| [OSD](widget/osd/) | Volume / brightness progress popup | on change |
| [Sound](widget/sound/) | Playback / capture volume and device mixer | click volume icon |
| [Capture](widget/capture/) | Screenshot / screen-record overlay | `Print` |
| [Wallpaper](widget/wallpaper/) | Wallpaper picker grid | `Super+W` |
| [Power menu](widget/powermenu/) | Lock / logout / reboot / shutdown | `Super+Shift+X` |
| [Power](widget/power/) | Power profiles and peripheral battery charges/states | click battery icon |
| [Tray](widget/tray/) | StatusNotifierItem icons (Zoom/Discord/…) | bottom-right corner |

## Install (Ubuntu — build from source)

AGS is not packaged for Ubuntu. One script does everything (needs `sudo` for
apt + `meson install`):

```bash
bash ~/.config/ags/install.sh
```

This installs the build deps, builds the Astal libraries + AGS CLI from source,
and prints the `GI_TYPELIB_PATH` note. That env var is already wired into
`zsh/.zshrc` and `hyprland/.config/hypr/hyprland.lua`.

### System tray (AstalTray)

The tray needs `AstalTray`, which in turn needs `appmenu-glib-translator` —
neither is packaged for Ubuntu. The install script builds both into
`~/.local` (no sudo, user-local prefix), so `GI_TYPELIB_PATH` includes
`~/.local/lib/x86_64-linux-gnu/girepository-1.0` and `LD_LIBRARY_PATH`
includes `~/.local/lib/x86_64-linux-gnu` (both already wired into the dotfiles).

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

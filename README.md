# dot-files

My dot-file collection, managed with [GNU Stow](https://www.gnu.org/software/stow/).

## Structure

Each directory is a stow package that mirrors the home directory structure:

| Package     | Description                          | Target           |
|-------------|--------------------------------------|------------------|
| `zsh/`      | Zsh shell config                     | `~/.zshrc`, etc. |
| `git/`      | Git configuration                    | `~/.gitconfig`   |
| `tmux/`     | Tmux terminal multiplexer            | `~/.tmux/`       |
| `mpv/`      | MPV media player                     | `~/.config/mpv/` |
| `kitty/`    | Kitty terminal emulator              | `~/.config/kitty/` |
| `zed/`      | Zed editor                           | `~/.config/zed/` |
| `opencode/` | OpenCode AI tool                     | `~/.config/opencode/` |
| `awesome/`  | AwesomeWM window manager             | `~/.config/awesome/` |
| `hyprland/` | Hyprland WM + waybar/swaync/wofi/etc | `~/.config/hypr/`, etc. |
| `ags/`      | [AGS desktop shell](ags/.config/ags/README.md) (bar, capture, wallpaper, …) | `~/.config/ags/` |
| `wal/`      | Pywal color scheme generator         | `~/.config/wal/` |
| `pi/`       | Pi coding agent config               | `~/.pi/`         |
| `agents/`   | Shared agent skills                  | `~/.agents/`     |

## Usage

### Install all packages

```bash
cd ~/Dev/dot-files
stow -v -t ~ zsh git tmux mpv kitty zed opencode awesome wal agents
stow --no-folding -v -t ~ pi  # pi needs --no-folding to avoid overwriting sessions/auth
```

### Install a single package

```bash
stow -v -t ~ zsh
```

### Uninstall a package

```bash
stow -D -v -t ~ zsh
```

### Re-stow (uninstall + install)

Useful after modifying package structure:

```bash
stow -R -v -t ~ zsh
```

## Notes

- **pi package**: Uses `--no-folding` because `~/.pi/agent/` contains local-only data (sessions, auth, binaries) that shouldn't be symlinked
- **agents package**: Skills are shared across coding agents (pi, claude-code, etc.) via symlinks from `~/.pi/agent/skills/` → `~/.agents/skills/`
- **First-time setup**: Back up existing configs before stowing, or use `stow --adopt` to move existing files into the package (dangerous!)
- **hyprland package**: Reads colors from pywal (`~/.cache/wal/colors-hyprland.conf` + `colors-waybar.css`), so the `wal` package must be set up first. The package's own `kitty.conf` was dropped in favour of the dedicated `kitty/` package.

## Dependencies

- [GNU Stow](https://www.gnu.org/software/stow/): `sudo apt install stow`

### Hyprland deps (Ubuntu 25.10)

```bash
# apt-available
sudo apt install -y waybar wofi swaylock swayidle hyprlock \
  cliphist wl-clipboard network-manager-gnome blueman \
  brightnessctl playerctl grim slurp policykit-1-gnome nextcloud-desktop

# not in apt:
#   swww      -> cargo install --git https://github.com/LGFae/swww --locked  (needs liblz4-dev)
#   hyprshot  -> curl raw script to ~/.local/bin/hyprshot
#   pyprland  -> uv tool install pyprland   (provides `pypr`)
```

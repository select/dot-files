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
| `wal/`      | Pywal color scheme generator         | `~/.config/wal/` |
| `pi/`       | Pi coding agent config               | `~/.pi/`         |
| `agents/`   | Shared agent skills                  | `~/.agents/`     |

## Usage

### Install all packages

```bash
cd ~/Dev/dot-files
stow -v -t $HOME zsh git tmux mpv kitty zed opencode awesome wal agents
stow --no-folding -v -t $HOME pi  # pi needs --no-folding to avoid overwriting sessions/auth
```

### Install a single package

```bash
stow -v -t $HOME zsh
```

### Uninstall a package

```bash
stow -D -v -t $HOME zsh
```

### Re-stow (uninstall + install)

Useful after modifying package structure:

```bash
stow -R -v -t $HOME zsh
```

## Notes

- **Use `$HOME` instead of `~`** when specifying the target directory, e.g. `stow -v -t $HOME zsh`. Some shells or contexts don't expand `~` correctly, and `$HOME` is more reliable in scripts and automation.
- **pi package**: Uses `--no-folding` because `~/.pi/agent/` contains local-only data (sessions, auth, binaries) that shouldn't be symlinked
- **agents package**: Skills are shared across coding agents (pi, claude-code, etc.) via symlinks from `~/.pi/agent/skills/` → `~/.agents/skills/`
- **First-time setup**: Back up existing configs before stowing, or use `stow --adopt` to move existing files into the package (dangerous!)

## Dependencies

- [GNU Stow](https://www.gnu.org/software/stow/): `sudo apt install stow`

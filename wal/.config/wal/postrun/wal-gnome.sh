#!/usr/bin/env bash
# Pywal postrun: apply wal colors to GNOME Shell top bar
# Requires: gnome-shell-extension-user-themes + user-themes extension enabled

THEME_NAME="wal-gnome"
THEME_DIR="$HOME/.local/share/themes/$THEME_NAME/gnome-shell"
SRC="$HOME/.cache/wal/gnome-shell.css"

# Bail out if wal hasn't generated the CSS yet
if [[ ! -f "$SRC" ]]; then
  echo "[wal-gnome] gnome-shell.css not found in wal cache, skipping."
  exit 0
fi

# Create theme directory structure
mkdir -p "$THEME_DIR"

# Copy generated CSS into the theme
cp "$SRC" "$THEME_DIR/gnome-shell.css"

# Apply the theme (requires user-themes extension enabled)
if gsettings set org.gnome.shell.extensions.user-theme name "$THEME_NAME" 2>/dev/null; then
  echo "[wal-gnome] Applied GNOME Shell theme: $THEME_NAME"
else
  echo "[wal-gnome] Could not apply theme — is the user-theme extension enabled?"
  echo "  Enable it with: gnome-extensions enable user-theme@gnome-shell-extensions.gcampax.github.com"
fi

# Reload GNOME Shell (Wayland: needs re-login; X11: can reload in-place)
if [[ "$XDG_SESSION_TYPE" == "x11" ]]; then
  busctl --user call org.gnome.Shell /org/gnome/Shell org.gnome.Shell Eval s 'Main.loadTheme();' 2>/dev/null \
    && echo "[wal-gnome] GNOME Shell theme reloaded." \
    || echo "[wal-gnome] Could not reload shell in-place (try Alt+F2 → r → Enter)"
else
  echo "[wal-gnome] Wayland session: log out and back in (or Alt+F2 → r on X11) to see changes."
fi

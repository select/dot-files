#!/usr/bin/env bash
# Pywal postrun: send updated colors to Firefox via pywalfox
# Requires: pywalfox installed (uv tool install pywalfox)
#           pywalfox extension in Firefox
#           native messaging host registered (see setup notes)
#
# NOTE: For snap Firefox the native messaging host manifest must be at:
#   ~/snap/firefox/common/.mozilla/native-messaging-hosts/pywalfox.json
# This is symlinked from ~/.mozilla/native-messaging-hosts/pywalfox.json

PYWALFOX="$HOME/.local/bin/pywalfox"

if [[ ! -x "$PYWALFOX" ]]; then
  echo "[pywalfox] pywalfox not found at $PYWALFOX, skipping."
  exit 0
fi

if "$PYWALFOX" update 2>/dev/null; then
  echo "[pywalfox] Firefox colors updated."
else
  echo "[pywalfox] Could not update Firefox colors (is Firefox running with the pywalfox extension?)."
fi

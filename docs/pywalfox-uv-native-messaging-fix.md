# Pywalfox "No such native application" Fix

## Original Error

Firefox browser extension **Pywalfox** (`pywalfox@frewacom.org`) reported:

> No such native application pywalfox

## Root Cause

Pywalfox is installed as a **uv tool** (`uv tool install pywalfox`). The Firefox native messaging manifest at `~/.mozilla/native-messaging-hosts/pywalfox.json` was pointing to a hand-crafted wrapper script:

```
~/.local/bin/pywalfox-native.sh
```

After a `uv` update or pywalfox upgrade, the tool's internal `main.sh` (the script that actually launches the daemon) was regenerated/moved inside the uv environment. The old wrapper still worked in isolation, but Firefox was throwing "No such native application" — likely because the manifest had gone stale or the path resolution failed at the browser level.

## Diagnosis Steps

1. Checked the manifest file:
   ```
   ~/.mozilla/native-messaging-hosts/pywalfox.json
   ```
   — pointed to `~/.local/bin/pywalfox-native.sh` (old custom wrapper)

2. Confirmed pywalfox is installed and working via uv:
   ```bash
   uv tool list | grep pywalfox
   # pywalfox v2.7.4
   ```

3. Confirmed the uv Python binary works:
   ```bash
   ~/.local/share/uv/tools/pywalfox/bin/python -m pywalfox start
   # (daemon started successfully)
   ```

4. Ran pywalfox's own install command to regenerate the manifest properly:
   ```bash
   pywalfox install
   ```

## Fix

Simply run:

```bash
pywalfox install
```

This:
- Removes the stale manifest at `~/.mozilla/native-messaging-hosts/pywalfox.json`
- Writes a fresh manifest pointing directly to `main.sh` inside the uv tool environment:
  ```
  ~/.local/share/uv/tools/pywalfox/lib/python3.13/site-packages/pywalfox/bin/main.sh
  ```
- Sets execute permissions on the daemon script

The `main.sh` inside the package is already uv-aware — it uses the isolated uv Python directly:

```bash
UV_PYTHON="$HOME/.local/share/uv/tools/pywalfox/bin/python"

if [[ -x "$UV_PYTHON" ]]; then
    exec "$UV_PYTHON" -m pywalfox start
fi

# Fallback: try system python
python -m pywalfox start || python3 -m pywalfox start
```

After running `pywalfox install`, **restart Firefox** for the native messaging connection to be re-established.

## Lesson Learned

When pywalfox (or any native messaging host) is installed via `uv tool`, the browser manifest must point to the script **inside the uv tool's package directory**, not a custom wrapper. After upgrading pywalfox, always re-run:

```bash
pywalfox install
```

to keep the manifest in sync with the installed version.

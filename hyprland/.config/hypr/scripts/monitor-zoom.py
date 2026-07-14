#!/usr/bin/env python3
import subprocess
import json
import time
import os
from datetime import datetime

LOG_FILE = os.path.expanduser("~/.config/hypr/state/zoom-popups.log")

# Ensure directory exists
os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

def ensure_hyprland_signature():
    """If HYPRLAND_INSTANCE_SIGNATURE is missing or points to a non-existent
    directory under XDG_RUNTIME_DIR/hypr (e.g. Hyprland crashed and restarted,
    leaving the service with a stale signature), auto-discover the active one."""
    current_sig = os.environ.get("HYPRLAND_INSTANCE_SIGNATURE")
    runtime_dir = os.environ.get("XDG_RUNTIME_DIR", f"/run/user/{os.getuid()}")
    hypr_dir = os.path.join(runtime_dir, "hypr")

    if current_sig and os.path.isdir(os.path.join(hypr_dir, current_sig)):
        return

    try:
        entries = [d for d in os.listdir(hypr_dir) if os.path.isdir(os.path.join(hypr_dir, d))]
    except FileNotFoundError:
        entries = []
    if len(entries) == 1:
        os.environ["HYPRLAND_INSTANCE_SIGNATURE"] = entries[0]
    elif len(entries) > 1:
        # Pick the most recently modified socket dir as a best guess
        entries.sort(key=lambda d: os.path.getmtime(os.path.join(hypr_dir, d)), reverse=True)
        os.environ["HYPRLAND_INSTANCE_SIGNATURE"] = entries[0]

ensure_hyprland_signature()

def log(msg):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    formatted = f"[{timestamp}] {msg}"
    print(formatted, flush=True)
    with open(LOG_FILE, "a") as f:
        f.write(formatted + "\n")

def get_zoom_clients():
    ensure_hyprland_signature()
    try:
        output = subprocess.check_output(["hyprctl", "clients", "-j"], text=True)
        clients = json.loads(output)
        return {c["address"]: c for c in clients if c.get("class") == "Zoom" or c.get("initialClass") == "Zoom"}
    except Exception as e:
        log(f"Error getting clients: {e}")
        return {}

log("Starting Zoom window monitor service...")

known_windows = get_zoom_clients()
for addr, win in known_windows.items():
    log(f"Already open: address={addr}, title={win.get('title')!r}, floating={win.get('floating')}, size={win.get('size')}, at={win.get('at')}")

while True:
    try:
        time.sleep(0.1)
        current_windows = get_zoom_clients()
        
        # Check for new windows
        for addr, win in current_windows.items():
            if addr not in known_windows:
                log(f"NEW WINDOW DETECTED:")
                log(f"  Title:         {win.get('title')!r}")
                log(f"  Initial Title: {win.get('initialTitle')!r}")
                log(f"  Class:         {win.get('class')!r}")
                log(f"  Address:       {addr}")
                log(f"  Size:          {win.get('size')}")
                log(f"  Position:      {win.get('at')}")
                log(f"  Floating:      {win.get('floating')}")
                log(f"  Fullscreen:    {win.get('fullscreen')}")
                log("-" * 40)
                
        # Check for closed windows
        for addr, win in known_windows.items():
            if addr not in current_windows:
                log(f"WINDOW CLOSED: title={win.get('title')!r}")
                
        known_windows = current_windows
    except KeyboardInterrupt:
        log("Monitoring stopped by user.")
        break
    except Exception as e:
        log(f"Unexpected error in loop: {e}")
        time.sleep(2)  # Avoid tight spinning on error

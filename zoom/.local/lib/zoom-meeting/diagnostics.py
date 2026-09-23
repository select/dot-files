#!/usr/bin/python3
"""Bounded metadata-only Zoom diagnostics. Python standard library only."""

import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
import re
import signal
import subprocess
import threading
import time

STATE = Path(os.environ.get("XDG_STATE_HOME", str(Path.home() / ".local/state"))) / "zoom-meeting"
INTERVAL = 3
TICKS = os.sysconf("SC_CLK_TCK")
PAGE = os.sysconf("SC_PAGE_SIZE")
UID = os.getuid()
STOP = threading.Event()
LOG = logging.getLogger("zoom-diagnostics")
CHILDREN = []
TARGETS = {"zoom", "ZoomLauncher", "Hyprland", "pipewire", "pipewire-pulse", "wireplumber", "xdg-desktop-por"}


def emit(event, **data):
    LOG.info(json.dumps({"event": event, **data}, separators=(",", ":")))


def text(path):
    try:
        return Path(path).read_text()
    except (OSError, UnicodeError):
        return ""


def stream(command, label, accept):
    try:
        process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    except OSError as error:
        emit("collector_error", source=label, error=str(error))
        return
    CHILDREN.append(process)

    def consume():
        try:
            for line in process.stdout:
                if accept(line):
                    emit(label, message=line.strip()[:2000])
            if not STOP.is_set():
                emit("collector_exit", source=label, returncode=process.wait())
        finally:
            process.stdout.close()

    threading.Thread(target=consume, daemon=True).start()


def processes(previous, elapsed):
    current = {}
    rows = []
    for path in Path("/proc").iterdir():
        if not path.name.isdigit():
            continue
        try:
            if path.stat().st_uid != UID:
                continue
            stat = (path / "stat").read_text()
            end = stat.rindex(")")
            name = stat[stat.index("(") + 1:end]
            fields = stat[end + 2:].split()
            ticks = int(fields[11]) + int(fields[12])
            identity = (int(path.name), fields[19])  # PID + start time avoids PID reuse.
            current[identity] = ticks
            cpu = None if identity not in previous else round(100 * (ticks - previous[identity]) / TICKS / elapsed, 1)
            group = text(path / "cgroup").strip()
            target = "zoom-workplace-" in group or name in TARGETS or name.startswith("Zoom")
            rows.append({"pid": int(path.name), "name": name, "cpu": cpu,
                         "rss_mib": round(int(fields[21]) * PAGE / 1048576, 1),
                         "target": target, "group": group if target else None})
        except (OSError, ValueError, IndexError):
            continue
    top = sorted(rows, key=lambda row: row["cpu"] or 0, reverse=True)[:8]
    targets = [row for row in rows if row["target"]]
    emit("processes", targets=targets, top=top)
    active = any("zoom-workplace-" in (row["group"] or "") or row["name"] == "zoom" for row in targets)
    return current, active


def pressure():
    memory = {}
    for line in text("/proc/meminfo").splitlines():
        key, value = line.split(":", 1)
        if key in {"MemAvailable", "SwapTotal", "SwapFree"}:
            memory[key] = value.strip()
    paging = {}
    for line in text("/proc/vmstat").splitlines():
        key, value = line.split()
        if key in {"pswpin", "pswpout", "pgmajfault"}:
            paging[key] = int(value)
    emit("pressure", psi={name: text(f"/proc/pressure/{name}").strip() for name in ("cpu", "memory", "io")},
         memory=memory, paging=paging)


def pipewire():
    try:
        result = subprocess.run(["pw-dump"], capture_output=True, text=True, timeout=2, check=True)
        objects = json.loads(result.stdout)
    except (OSError, subprocess.SubprocessError, ValueError) as error:
        return {"error": str(error)}
    nodes = []
    for obj in objects:
        if obj.get("type") != "PipeWire:Interface:Node":
            continue
        info = obj.get("info", {})
        props = info.get("props", {})
        application = str(props.get("application.name", ""))
        binary = str(props.get("application.process.binary", ""))
        # Do not store titles, device names, media content, meeting URLs or tokens.
        if not any(word in str(props.get("media.class", "")) for word in ("Video",)) and not any(
            word in (application + binary).lower() for word in ("zoom", "portal")
        ):
            continue
        nodes.append({"id": obj["id"], "serial": props.get("object.serial"), "state": info.get("state"),
                      "class": props.get("media.class"), "binary": binary,
                      "pid": props.get("application.process.id"),
                      "params": {key: value for key, value in info.get("params", {}).items()
                                 if key in {"Format", "Buffers"}}})
    return nodes


def main():
    os.umask(0o077)
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    handler = RotatingFileHandler(STATE / "diagnostics.log", maxBytes=8 * 1024 * 1024, backupCount=3)
    handler.setFormatter(logging.Formatter("%(asctime)s %(message)s"))
    LOG.addHandler(handler)
    LOG.setLevel(logging.INFO)
    for sig in (signal.SIGTERM, signal.SIGINT):
        signal.signal(sig, lambda *_: STOP.set())
    emit("collector_start", interval=INTERVAL,
         capture_config=text(Path.home() / ".config/hypr/xdph.conf"))
    pattern = re.compile(r"error|fail|closed|disconnect|timeout|out of buffers|state.*changed|renegotiat|buffer_type|framerate|\| size:", re.I)
    stream(["journalctl", "--user", "--follow", "--since", "now", "--output=short-iso", "--no-pager",
            "-u", "xdg-desktop-portal-hyprland", "-u", "xdg-desktop-portal", "-u", "pipewire", "-u", "wireplumber"],
           "journal", lambda line: bool(pattern.search(line)))
    # Only message headers: no D-Bus arguments (which can contain private titles/tokens).
    stream(["dbus-monitor", "--session",
            "interface='org.freedesktop.portal.Session'",
            "interface='org.freedesktop.impl.portal.Session'",
            "interface='org.freedesktop.portal.ScreenCast'",
            "interface='org.freedesktop.impl.portal.ScreenCast'"],
           "portal_bus", lambda line: line.startswith(("signal ", "method call ", "error ")))
    previous = {}
    last = time.monotonic()
    last_active = last
    old_nodes = None
    iteration = 0
    try:
        while not STOP.is_set():
            now = time.monotonic()
            previous, active = processes(previous, max(now - last, 0.001))
            last = now
            if active:
                last_active = now
            pressure()
            if iteration % 2 == 0:
                nodes = pipewire()
                if nodes != old_nodes:
                    emit("pipewire", nodes=nodes)
                    old_nodes = nodes
            iteration += 1
            if now - last_active >= 60:
                emit("collector_idle_exit")
                break
            STOP.wait(max(0, INTERVAL - (time.monotonic() - now)))
    finally:
        STOP.set()
        for process in CHILDREN:
            if process.poll() is None:
                process.terminate()
        for process in CHILDREN:
            try:
                process.wait(timeout=2)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
        emit("collector_stop")
        logging.shutdown()


if __name__ == "__main__":
    main()

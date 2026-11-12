"""Bounded PTY smoke tests; stdlib only. Run with uv run python viewer-smoke.py."""
import errno
import fcntl
import os
from pathlib import Path
import pty
import secrets
import select
import signal
import struct
import subprocess
import tempfile
import termios
import time
import zlib

VIEWER = Path(__file__).with_name("viewer.ts")


def chunk(kind, data):
    return struct.pack("!I", len(data)) + kind + data + struct.pack("!I", zlib.crc32(kind + data))


PNG = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack("!IIBBBBB", 16, 16, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress((b"\0" + b"\x40\x80\xff" * 16) * 16)) + chunk(b"IEND", b""))


def run(close):
    directory = Path(tempfile.gettempdir()) / ("pi-images-" + secrets.token_hex(8))
    directory.mkdir(mode=0o700)
    image = directory / "image.png"
    image.write_bytes(PNG)
    image.chmod(0o600)
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 80, 800, 600))

    def terminal():
        os.setsid()
        fcntl.ioctl(slave, termios.TIOCSCTTY, 0)

    process = subprocess.Popen(["bun", str(VIEWER)], stdin=slave, stdout=slave, stderr=slave,
                               env={**os.environ, "PI_IMAGE_VIEWER_FILE": str(image)}, preexec_fn=terminal)
    os.close(slave)
    output = bytearray()

    def read_until(marker):
        deadline = time.monotonic() + 15
        while time.monotonic() < deadline:
            if marker in output:
                return
            if select.select([master], [], [], 0.1)[0]:
                try:
                    data = os.read(master, 65536)
                except OSError as error:
                    if error.errno == errno.EIO:
                        break
                    raise
                output.extend(data)
                if b"\x1b[14t" in data:
                    os.write(master, b"\x1b[4;600;800t")
                if b"\x1b[16t" in data:
                    os.write(master, b"\x1b[6;20;10t")
        raise AssertionError(f"Missing {marker!r}; output={output[-2000:]!r}")

    try:
        read_until(b"Esc / Q: return")
        assert b"Cannot display" not in output, output[-2000:]
        # A transmitted PNG, not merely the graphics-delete escape sequence.
        assert b"f=100" in output or b"a=T" in output, output[-2000:]
        fcntl.ioctl(master, termios.TIOCSWINSZ, struct.pack("HHHH", 20, 60, 600, 400))
        process.send_signal(signal.SIGWINCH)
        read_until(b"\x1b[20;1H")
        if close == "signal":
            process.send_signal(signal.SIGTERM)
        else:
            os.write(master, close)
        assert process.wait(timeout=5) == 0
        assert not directory.exists(), "Viewer did not remove private image directory"
        print(f"PASS: actual kitten image, resize, {close!r}, cleanup")
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()
        os.close(master)
        image.unlink(missing_ok=True)
        if directory.exists():
            directory.rmdir()


for close in [b"q", b"\x1b", "signal"]:
    run(close)

# Refuse arbitrary paths without deleting them.
with tempfile.TemporaryDirectory(prefix="not-pi-images-") as directory:
    image = Path(directory) / "image.png"
    image.write_bytes(PNG)
    result = subprocess.run(["bun", str(VIEWER)], env={**os.environ, "PI_IMAGE_VIEWER_FILE": str(image)},
                            capture_output=True, timeout=5)
    assert result.returncode == 1
    assert image.exists()
    print("PASS: arbitrary image path rejected and preserved")

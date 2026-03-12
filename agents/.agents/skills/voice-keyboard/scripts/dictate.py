#!/usr/bin/env python3
"""
Voice Keyboard - Fast push-to-talk voice dictation for Linux.
Hold the hotkey to record, release to transcribe and type.

Based on: https://github.com/ksred/soupawhisper
Inspired by: https://github.com/martintrojer/soupawhisper
"""

import argparse
import configparser
import contextlib
import os
import selectors
import signal
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

import evdev
from evdev import UInput, ecodes
from faster_whisper import WhisperModel

__version__ = "0.2.0"

# Load configuration
CONFIG_PATH = Path.home() / ".config" / "voice-keyboard" / "config.ini"


def load_config():
    config = configparser.ConfigParser()
    defaults = {
        "model": "tiny.en",
        "device": "cuda",
        "compute_type": "float16",
        "key": "alt_gr",
        "auto_type": "true",
        "notifications": "true",
        "grab_keyboard": "false",
    }

    if CONFIG_PATH.exists():
        config.read(CONFIG_PATH)

    return {
        "model": config.get("whisper", "model", fallback=defaults["model"]),
        "device": config.get("whisper", "device", fallback=defaults["device"]),
        "compute_type": config.get("whisper", "compute_type", fallback=defaults["compute_type"]),
        "key": config.get("hotkey", "key", fallback=defaults["key"]),
        "auto_type": config.getboolean("behavior", "auto_type", fallback=True),
        "notifications": config.getboolean("behavior", "notifications", fallback=True),
        "grab_keyboard": config.getboolean("behavior", "grab_keyboard", fallback=False),
    }


CONFIG = load_config()

# Map key names to evdev key codes
KEY_MAP = {
    "f1": ecodes.KEY_F1,
    "f2": ecodes.KEY_F2,
    "f3": ecodes.KEY_F3,
    "f4": ecodes.KEY_F4,
    "f5": ecodes.KEY_F5,
    "f6": ecodes.KEY_F6,
    "f7": ecodes.KEY_F7,
    "f8": ecodes.KEY_F8,
    "f9": ecodes.KEY_F9,
    "f10": ecodes.KEY_F10,
    "f11": ecodes.KEY_F11,
    "f12": ecodes.KEY_F12,
    "scroll_lock": ecodes.KEY_SCROLLLOCK,
    "pause": ecodes.KEY_PAUSE,
    "insert": ecodes.KEY_INSERT,
    "home": ecodes.KEY_HOME,
    "end": ecodes.KEY_END,
    "pageup": ecodes.KEY_PAGEUP,
    "pagedown": ecodes.KEY_PAGEDOWN,
    "capslock": ecodes.KEY_CAPSLOCK,
    "numlock": ecodes.KEY_NUMLOCK,
    "alt_gr": ecodes.KEY_RIGHTALT,
    "altgr": ecodes.KEY_RIGHTALT,
    "rightalt": ecodes.KEY_RIGHTALT,
    "right_alt": ecodes.KEY_RIGHTALT,
}


def get_hotkey(key_name):
    """Map key name to evdev key code."""
    key_name = key_name.lower()
    if key_name in KEY_MAP:
        return KEY_MAP[key_name]
    if len(key_name) == 1:
        key_attr = f"KEY_{key_name.upper()}"
        if hasattr(ecodes, key_attr):
            return getattr(ecodes, key_attr)
    print(f"Unknown key: {key_name}, defaulting to alt_gr")
    return ecodes.KEY_RIGHTALT


def get_key_name(keycode):
    """Get human-readable name for a key code."""
    for name, code in KEY_MAP.items():
        if code == keycode:
            return name.upper()
    name = ecodes.KEY.get(keycode, f"KEY_{keycode}")
    if isinstance(name, (list, tuple)):
        name = name[0]
    return name.replace("KEY_", "") if isinstance(name, str) else str(name)


HOTKEY = get_hotkey(CONFIG["key"])
MODEL_SIZE = CONFIG["model"]
DEVICE = CONFIG["device"]
COMPUTE_TYPE = CONFIG["compute_type"]
AUTO_TYPE = CONFIG["auto_type"]
NOTIFICATIONS = CONFIG["notifications"]
GRAB_KEYBOARD = CONFIG["grab_keyboard"]


def copy_to_clipboard(text):
    """Copy text to clipboard."""
    if os.environ.get("WAYLAND_DISPLAY"):
        process = subprocess.Popen(["wl-copy"], stdin=subprocess.PIPE)
        process.communicate(input=text.encode())
    elif os.environ.get("DISPLAY"):
        process = subprocess.Popen(["xclip", "-selection", "clipboard"], stdin=subprocess.PIPE)
        process.communicate(input=text.encode())


def type_text(text):
    """Type text into the active input field using clipboard paste."""
    import time

    if os.environ.get("WAYLAND_DISPLAY"):
        if subprocess.run(["which", "wtype"], capture_output=True).returncode == 0:
            subprocess.run(["wtype", text])
        elif subprocess.run(["which", "ydotool"], capture_output=True).returncode == 0:
            subprocess.run(["ydotool", "type", "--", text])
    elif os.environ.get("DISPLAY"):
        # Save current clipboard content
        old_clipboard = subprocess.run(
            ["xclip", "-selection", "clipboard", "-o"], capture_output=True
        ).stdout
        old_primary = subprocess.run(
            ["xclip", "-selection", "primary", "-o"], capture_output=True
        ).stdout

        # Copy to both clipboard selections (some apps use CLIPBOARD, others PRIMARY)
        for selection in ["clipboard", "primary"]:
            process = subprocess.Popen(["xclip", "-selection", selection], stdin=subprocess.PIPE)
            process.communicate(input=text.encode())
            process.wait()

        time.sleep(0.02)  # Let clipboard sync

        # Paste with Shift+Insert
        subprocess.run(["xdotool", "key", "--clearmodifiers", "shift+Insert"])

        # Restore original clipboard
        time.sleep(0.1)
        if old_clipboard:
            process = subprocess.Popen(["xclip", "-selection", "clipboard"], stdin=subprocess.PIPE)
            process.communicate(input=old_clipboard)
        if old_primary:
            process = subprocess.Popen(["xclip", "-selection", "primary"], stdin=subprocess.PIPE)
            process.communicate(input=old_primary)


def get_audio_recorder():
    """Determine which audio recorder to use."""
    if subprocess.run(["which", "pw-record"], capture_output=True).returncode == 0:
        return "pipewire"
    if subprocess.run(["which", "arecord"], capture_output=True).returncode == 0:
        return "alsa"
    return None


def get_record_command(output_file):
    """Get the command to record audio."""
    if get_audio_recorder() == "pipewire":
        return [
            "pw-record",
            "--format",
            "s16",
            "--rate",
            "16000",
            "--channels",
            "1",
            output_file,
        ]
    return [
        "arecord",
        "-f",
        "S16_LE",
        "-r",
        "16000",
        "-c",
        "1",
        "-t",
        "wav",
        output_file,
    ]


def find_keyboards():
    """Find all keyboard input devices."""
    keyboards = []
    for path in evdev.list_devices():
        try:
            device = evdev.InputDevice(path)
            caps = device.capabilities()
            if ecodes.EV_KEY in caps:
                keys = caps[ecodes.EV_KEY]
                if ecodes.KEY_A in keys or ecodes.KEY_SPACE in keys:
                    keyboards.append(device)
        except (PermissionError, OSError):
            pass
    return keyboards


def create_uinput(keyboards):
    """Create a virtual keyboard for re-injecting events."""
    all_caps = {}
    for kb in keyboards:
        caps = kb.capabilities()
        for event_type, codes in caps.items():
            if event_type == ecodes.EV_SYN:
                continue
            if event_type not in all_caps:
                all_caps[event_type] = set()
            if isinstance(codes, list):
                for code in codes:
                    all_caps[event_type].add(code[0] if isinstance(code, tuple) else code)
            else:
                all_caps[event_type].add(codes)

    from collections.abc import Sequence
    from typing import cast

    caps_for_uinput = cast(dict[int, Sequence[int]], {k: list(v) for k, v in all_caps.items()})
    return UInput(caps_for_uinput, name="Voice Keyboard Virtual Keyboard")


class Dictation:
    def __init__(self, grab=False):
        self.recording = False
        self.record_process = None
        self.temp_file = None
        self.model = None
        self.model_loaded = threading.Event()
        self.model_error = None
        self.running = True
        self.keyboards = []
        self.selector = None
        self.uinput = None
        self.grab = grab

        print(f"Loading Whisper model ({MODEL_SIZE})...")
        threading.Thread(target=self._load_model, daemon=True).start()

    def _load_model(self):
        try:
            import struct
            import time
            import wave

            start = time.time()
            self.model = WhisperModel(MODEL_SIZE, device=DEVICE, compute_type=COMPUTE_TYPE)
            load_time = time.time() - start

            # Warm up CUDA with dummy transcription
            print(f"Model loaded in {load_time:.1f}s, warming up...")
            warmup_start = time.time()
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=True) as f:
                with wave.open(f.name, "w") as w:
                    w.setnchannels(1)
                    w.setsampwidth(2)
                    w.setframerate(16000)
                    w.writeframes(struct.pack("<" + "h" * 1600, *([0] * 1600)))
                list(self.model.transcribe(f.name, beam_size=5)[0])

            self.model_loaded.set()
            print(f"Ready! (warmup: {time.time() - warmup_start:.1f}s)")
            print(f"Hold [{get_key_name(HOTKEY)}] to record, release to transcribe.")
            print("Press Ctrl+C to quit.")
        except Exception as e:
            self.model_error = str(e)
            self.model_loaded.set()
            print(f"Failed to load model: {e}")

    def notify(self, title, message, icon="dialog-information", timeout=2000):
        """Send a desktop notification."""
        if not NOTIFICATIONS:
            return
        subprocess.run(
            [
                "notify-send",
                "-a",
                "Voice Keyboard",
                "-i",
                icon,
                "-t",
                str(timeout),
                "-h",
                "string:x-canonical-private-synchronous:voice-keyboard",
                title,
                message,
            ],
            capture_output=True,
        )

    def start_recording(self):
        if self.recording or self.model_error:
            return

        self.recording = True
        self.temp_file = tempfile.mktemp(suffix=".wav")

        self.record_process = subprocess.Popen(
            get_record_command(self.temp_file),
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        print("Recording...")
        self.notify(
            "Recording...",
            f"Release {get_key_name(HOTKEY)} when done",
            "audio-input-microphone",
            30000,
        )

    def stop_recording(self):
        if not self.recording:
            return

        self.recording = False
        if self.record_process:
            self.record_process.terminate()
            self.record_process.wait()
            self.record_process = None

        audio_size = os.path.getsize(self.temp_file) if self.temp_file else 0
        audio_duration = audio_size / (16000 * 2)
        print(f"Transcribing {audio_duration:.1f}s audio...")
        self.notify("Transcribing...", "Processing your speech", "emblem-synchronizing", 30000)

        temp_file = self.temp_file
        self.temp_file = None
        threading.Thread(target=self._transcribe, args=(temp_file,), daemon=True).start()

    def _transcribe(self, temp_file):
        """Transcribe audio file."""
        import time

        self.model_loaded.wait()
        if self.model_error:
            print("Cannot transcribe: model failed to load")
            return

        try:
            start = time.time()
            segments, _ = self.model.transcribe(temp_file, beam_size=5, vad_filter=True)
            text = " ".join(segment.text.strip() for segment in segments)

            if text:
                copy_to_clipboard(text)
                if AUTO_TYPE:
                    type_text(text)
                print(f"[{time.time() - start:.2f}s] {text}")
                self.notify(
                    "Copied!",
                    text[:100] + ("..." if len(text) > 100 else ""),
                    "emblem-ok-symbolic",
                    3000,
                )
            else:
                print("No speech detected")
                self.notify("No speech detected", "Try speaking louder", "dialog-warning", 2000)
        except Exception as e:
            print(f"Error: {e}")
            self.notify("Error", str(e)[:50], "dialog-error", 3000)
        finally:
            if temp_file and os.path.exists(temp_file):
                os.unlink(temp_file)

    def handle_event(self, event):
        """Handle keyboard event."""
        if event.type == ecodes.EV_KEY and event.code == HOTKEY:
            if event.value == 1:
                self.start_recording()
            elif event.value == 0:
                self.stop_recording()
            return

        if self.grab and self.uinput:
            self.uinput.write_event(event)
            if event.type != ecodes.EV_SYN:
                self.uinput.syn()

    def cleanup(self):
        """Release grabbed devices."""
        if self.grab:
            for kb in self.keyboards:
                with contextlib.suppress(OSError):
                    kb.ungrab()
            if self.uinput:
                self.uinput.close()

    def stop(self):
        print("\nExiting...")
        self.running = False
        self.cleanup()
        os.kill(os.getpid(), signal.SIGKILL)

    def run(self):
        self.keyboards = find_keyboards()
        if not self.keyboards:
            print("Error: No keyboards found!")
            print("Make sure you're in the 'input' group: sudo usermod -aG input $USER")
            sys.exit(1)

        if self.grab:
            try:
                self.uinput = create_uinput(self.keyboards)
            except OSError as e:
                print(f"Error creating virtual keyboard: {e}")
                sys.exit(1)

            for kb in self.keyboards:
                try:
                    kb.grab()
                except OSError as e:
                    print(f"Warning: Could not grab {kb.name}: {e}")

        print(f"Monitoring {len(self.keyboards)} keyboard(s)...")

        self.selector = selectors.DefaultSelector()
        for kb in self.keyboards:
            self.selector.register(kb, selectors.EVENT_READ)

        try:
            while self.running:
                for key, _ in self.selector.select(timeout=1):
                    device = key.fileobj
                    if not isinstance(device, evdev.InputDevice):
                        continue
                    try:
                        for event in device.read():
                            self.handle_event(event)
                    except OSError:
                        self.selector.unregister(device)
        finally:
            self.cleanup()


def check_cuda_available():
    """Check if CUDA is available."""
    try:
        import ctranslate2

        return len(ctranslate2.get_supported_compute_types("cuda")) > 0
    except Exception:
        return False


def check_dependencies():
    """Check required system commands."""
    missing = []

    if get_audio_recorder() is None:
        missing.append(("pw-record or arecord", "pipewire or alsa-utils"))

    if AUTO_TYPE:
        if os.environ.get("WAYLAND_DISPLAY"):
            if subprocess.run(["which", "wtype"], capture_output=True).returncode != 0:
                missing.append(("wtype", "wtype"))
        elif subprocess.run(["which", "xdotool"], capture_output=True).returncode != 0:
            missing.append(("xdotool", "xdotool"))

    if missing:
        print("Missing dependencies:")
        for cmd, pkg in missing:
            print(f"  {cmd} - install with: sudo apt install {pkg}")
        sys.exit(1)


def main():
    parser = argparse.ArgumentParser(description="Voice Keyboard - Push-to-talk voice dictation")
    parser.add_argument(
        "-v", "--version", action="version", version=f"Voice Keyboard {__version__}"
    )
    parser.parse_args()

    print(f"Voice Keyboard v{__version__}")
    if CONFIG_PATH.exists():
        print(f"Config: {CONFIG_PATH}")
    else:
        print(f"Config: using defaults (create {CONFIG_PATH} to customize)")

    if DEVICE == "cuda":
        if check_cuda_available():
            import ctranslate2

            types = ctranslate2.get_supported_compute_types("cuda")
            print(f"CUDA available (compute types: {', '.join(types)})")
        else:
            print("ERROR: CUDA configured but not available!")
            print("Change config to: device = cpu, compute_type = int8")
            sys.exit(1)

    check_dependencies()

    dictation = Dictation(grab=GRAB_KEYBOARD)
    signal.signal(signal.SIGINT, lambda s, f: dictation.stop())
    dictation.run()


if __name__ == "__main__":
    main()

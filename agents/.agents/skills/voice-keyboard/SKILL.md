---
name: voice-keyboard
description: "Manage the voice keyboard push-to-talk dictation tool. Use this skill when: start voice keyboard, stop voice keyboard, install voice keyboard, voice dictation, push-to-talk, voice typing"
---

# Purpose

Manage the voice keyboard — a self-contained push-to-talk dictation tool using faster-whisper for local speech-to-text. Hold **AltGr** to record, release to transcribe and type.

All source code lives inside this skill directory — no external repo needed.

## Variables

- **SKILL_DIR**: The directory containing this skill (where `dictate.py` and `pyproject.toml` live)
- **LOG_FILE**: `/tmp/voice-keyboard.log`
- **CONFIG**: `~/.config/voice-keyboard/config.ini`
- **SCRIPT**: `{SKILL_DIR}/scripts/voice-keyboard.sh`

## Skill Contents

```
voice-keyboard/
├── SKILL.md                  # This file
├── config.example.ini        # Example config (copied to ~/.config on install)
└── scripts/
    ├── voice-keyboard.sh     # Helper script (install/start/stop/status/restart/logs)
    ├── dictate.py            # Main Python application
    ├── pyproject.toml        # Python project + dependencies
    └── uv.lock               # Locked dependency versions
```

## Instructions

Use `{SKILL_DIR}/scripts/voice-keyboard.sh` for all operations.
Always check status first before starting or stopping.

## Workflow

> Execute steps based on what the user wants:

---

### Check Status

```bash
{SKILL_DIR}/scripts/voice-keyboard.sh status
```

- `STATUS: running (PID: ...)` → voice keyboard is active
- `STATUS: stopped` → voice keyboard is not running

---

### Install

Run when the user wants to install or first-time setup:

```bash
{SKILL_DIR}/scripts/voice-keyboard.sh install
```

This will:
1. Run `uv sync` inside `{SKILL_DIR}` to create `.venv` and install `faster-whisper` + `evdev`
2. Copy `config.example.ini` → `~/.config/voice-keyboard/config.ini` (if not already present)
3. Warn if the user is not in the `input` group

**If user is NOT in `input` group**, inform them:
```bash
sudo usermod -aG input $USER
# Then log out and back in
```

---

### Start

```bash
{SKILL_DIR}/scripts/voice-keyboard.sh start
```

- Requires install to have been run first (`.venv` must exist)
- Starts `dictate.py` in background via `nohup uv run python dictate.py`
- If already running: reports PID, no action taken
- On success: reports PID and log location
- **Usage**: Hold **AltGr** to record → release to transcribe → text is typed into active field

---

### Stop

```bash
{SKILL_DIR}/scripts/voice-keyboard.sh stop
```

---

### Restart

Use after config changes:

```bash
{SKILL_DIR}/scripts/voice-keyboard.sh restart
```

---

### View Logs

```bash
{SKILL_DIR}/scripts/voice-keyboard.sh logs
```

Or follow live:
```bash
tail -f /tmp/voice-keyboard.log
```

---

## Configuration

Config file: `~/.config/voice-keyboard/config.ini`

```ini
[whisper]
model = tiny.en       # tiny.en, base.en, small.en, medium.en, large-v3
device = cuda         # cpu or cuda
compute_type = float16

[hotkey]
key = alt_gr          # hold this key to record

[behavior]
auto_type = true
notifications = true
grab_keyboard = false
```

After editing, restart:
```bash
{SKILL_DIR}/scripts/voice-keyboard.sh restart
```

---

## Cookbook

- IF: User says "start voice keyboard" or "enable dictation"
- THEN: Check status → if stopped, run start

- IF: User says "stop voice keyboard" or "disable dictation"
- THEN: Check status → if running, run stop

- IF: User says "install voice keyboard" or first-time setup
- THEN: Run install, report results and any warnings about `input` group

- IF: User says "restart voice keyboard" or "reload config"
- THEN: Run restart

- IF: User says "voice keyboard logs" or "why isn't it working"
- THEN: Run logs, report output

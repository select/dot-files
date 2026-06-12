---
name: slack-tools
description: "Send messages, send files, read messages, search, and list channels on Slack. Use this skill when: send slack message, slack DM, read slack, slack file, slack search, slack channel, message someone on slack"
---

# Purpose

Interact with the local Slack desktop app to send messages, upload files, read messages from channels/DMs, read threads, search messages, and list channels. Uses locally extracted tokens from the Slack snap installation — no API keys needed.

## Prerequisites

- Slack desktop app installed via snap (`~/snap/slack/`)
- Python 3.13+ with `uv` available
- GNOME keyring accessible (for cookie decryption)

## Instructions

The skill provides a single unified Python script at `{baseDir}/scripts/slack.py` with subcommands: `send`, `send-file`, `read`, `thread`, `search`, `list`.

Targets can be a **user display name** (e.g. `Ruda`, `Falko`), a **channel name** (e.g. `general`), or a **channel ID**.

## Workflow

> Execute the following steps in order, top to bottom:

1. **Determine what the user wants to do**

   Map the user's request to one of the subcommands:
   - "send message to X" → `send`
   - "send file to X" → `send-file`
   - "read messages from X" → `read`
   - "read thread" → `thread`
   - "search slack for X" → `search`
   - "list channels" → `list`

2. **Install dependencies (first run only)**

   ```bash
   cd {baseDir}/scripts && uv sync
   ```

3. **Run the appropriate command**

   Use `uv run` from the scripts directory:

   ```bash
   cd {baseDir}/scripts && uv run python slack.py <subcommand> [args]
   ```

4. **Report result** — Show success/failure output to the user.

## Script Reference

### Send messages

```bash
# Send a single message
uv run python slack.py send "Ruda" "Hello!"

# Send multiple messages
uv run python slack.py send "Ruda" "Hello!" "How are you?" "See you later"

# Send the same message 5 times
uv run python slack.py send "Ruda" "Hello" --repeat 5

# Send to a channel
uv run python slack.py send "general" "Hey team!"

# Reply in a thread
uv run python slack.py send "C08TGQZEY1H" "Thanks!" --thread-ts "1775567823.744029"
```

### Send files

```bash
# Upload a file to a user
uv run python slack.py send-file "Falko" ./screenshot.png

# Upload with a message
uv run python slack.py send-file "Falko" ./report.pdf -m "Here's the report"

# Upload multiple files
uv run python slack.py send-file "#general" file1.png file2.png
```

### Read messages

```bash
# Read last 20 messages from a DM
uv run python slack.py read "Ruda"

# Read last 50 messages from a channel
uv run python slack.py read "general" -n 50
```

### Read a thread

```bash
# Read thread replies (use timestamp from read output or Slack URL)
uv run python slack.py thread "C08TGQZEY1H" "1775567823.744029"

# Read thread in a DM
uv run python slack.py thread "Ruda" "1711234567.123456"
```

**Extracting thread timestamp from Slack URLs:**
Slack thread URLs look like: `https://apheris.slack.com/archives/C08TGQZEY1H/p1775567823744029`
- The channel ID is the path segment after `/archives/` (e.g. `C08TGQZEY1H`)
- The timestamp starts with `p`, remove the `p` and insert a `.` before the last 6 digits: `p1775567823744029` → `1775567823.744029`

### Search messages

```bash
uv run python slack.py search "deployment issue" -n 10
```

### List channels

```bash
uv run python slack.py list
uv run python slack.py list -t "public_channel"
```

## Cookbook

- IF: User says "send 5 hello messages to Ruda"
- THEN: `uv run python slack.py send "Ruda" "Hello" --repeat 5`

- IF: User says "reply in this thread" with a Slack URL like `https://apheris.slack.com/archives/C08TGQZEY1H/p1775567823744029`
- THEN: Extract channel ID `C08TGQZEY1H` and timestamp `1775567823.744029`, then `uv run python slack.py send "C08TGQZEY1H" "message" --thread-ts "1775567823.744029"`

- IF: User says "read this thread" with a Slack URL
- THEN: Extract channel ID and timestamp from URL, then `uv run python slack.py thread "C08TGQZEY1H" "1775567823.744029"`

- IF: User says "read my DMs with Falko"
- THEN: `uv run python slack.py read "Falko"`

- IF: User says "send this image to #general"
- THEN: `uv run python slack.py send-file "general" ./image.png`

- IF: User says "search slack for deployment"
- THEN: `uv run python slack.py search "deployment"`

- IF: User provides a channel ID directly (e.g. `C02UN6GPLQ1`)
- THEN: Use it directly as the target argument

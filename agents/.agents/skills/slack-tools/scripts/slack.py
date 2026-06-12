#!/usr/bin/env python3
"""Unified Slack CLI tool: send messages, send files, read messages, search, list channels."""

import argparse
import glob
import hashlib
import hmac
import json
import os
import re
import sqlite3
import sys
import time
import urllib.parse
import urllib.request
from datetime import datetime
from pathlib import Path

# --- Config ---
_SLACK_SNAP = os.path.expanduser("~/snap/slack/current/.config/Slack")
_SLACK_DESKTOP = os.path.expanduser("~/.config/Slack")
SLACK_DATA = _SLACK_SNAP if os.path.isdir(_SLACK_SNAP) else _SLACK_DESKTOP
COOKIES_DB = os.path.join(SLACK_DATA, "Cookies")
LEVELDB_DIR = os.path.join(SLACK_DATA, "Local Storage", "leveldb")
CACHE_DIR = Path(os.path.expanduser("~/.cache/slack-tools"))
CHANNEL_CACHE_FILE = CACHE_DIR / "channels.json"
CHANNEL_CACHE_TTL = 24 * 60 * 60  # 1 day in seconds


# ─── Auth helpers ───────────────────────────────────────────────────────────

def get_xoxc_tokens():
    """Extract xoxc tokens from LevelDB files."""
    tokens = set()
    for pattern in ["*.ldb", "*.log"]:
        for fpath in glob.glob(os.path.join(LEVELDB_DIR, pattern)):
            with open(fpath, "rb") as f:
                data = f.read()
                for match in re.finditer(rb"xoxc-[a-zA-Z0-9-]+", data):
                    tokens.add(match.group().decode())
    return list(tokens)


def decrypt_cookie_linux():
    """Decrypt Slack's 'd' cookie on Linux (snap installation)."""
    from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
    from cryptography.hazmat.backends import default_backend
    import secretstorage

    connection = secretstorage.dbus_init()
    collection = secretstorage.get_default_collection(connection)

    password = None
    for item in collection.get_all_items():
        attrs = item.get_attributes()
        if attrs.get("application") == "Slack" and "Safe Storage" in item.get_label():
            password = item.get_secret()
            break

    if password is None:
        raise RuntimeError("Could not find Slack Safe Storage key in keyring")

    password_str = password.decode("utf-8")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA1(),
        length=16,
        salt=b"saltysalt",
        iterations=1,
        backend=default_backend(),
    )
    key = kdf.derive(password_str.encode("utf-8"))

    conn = sqlite3.connect(COOKIES_DB)
    encrypted_value = conn.execute(
        "SELECT encrypted_value FROM cookies WHERE name='d' LIMIT 1"
    ).fetchone()[0]
    conn.close()

    encrypted = encrypted_value[3:]
    cipher = Cipher(algorithms.AES(key), modes.CBC(b" " * 16), backend=default_backend())
    decryptor = cipher.decryptor()
    decrypted = decryptor.update(encrypted) + decryptor.finalize()

    pad_len = decrypted[-1]
    if 1 <= pad_len <= 16:
        decrypted = decrypted[:-pad_len]
    decrypted = decrypted[32:]

    return decrypted.decode("utf-8")


def slack_api(method, token, cookie, data=None, *, use_get=False, _retries=2):
    """Call Slack API. Use use_get=True for endpoints that require query-string params (e.g. conversations.replies).
    Automatically retries on 429 Too Many Requests with exponential backoff."""
    headers = {
        "Authorization": f"Bearer {token}",
        "Cookie": f"d={cookie}",
    }
    if use_get and data:
        qs = urllib.parse.urlencode(data)
        url = f"https://slack.com/api/{method}?{qs}"
        req = urllib.request.Request(url, headers=headers)
    else:
        url = f"https://slack.com/api/{method}"
        headers["Content-Type"] = "application/json; charset=utf-8"
        body = json.dumps(data).encode() if data else None
        req = urllib.request.Request(url, data=body, headers=headers)

    for attempt in range(_retries):
        try:
            with urllib.request.urlopen(req) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            if e.code == 429 and attempt < _retries - 1:
                retry_after = int(e.headers.get("Retry-After", 2 ** (attempt + 1)))
                print(f"  ⏳ Rate limited by Slack ({method}), waiting {retry_after}s before retry {attempt + 1}/{_retries - 1}...", file=sys.stderr)
                time.sleep(retry_after)
            else:
                raise


def get_auth():
    """Get a working token+cookie pair. Returns (token, cookie, auth_info) or exits."""
    tokens = get_xoxc_tokens()
    cookie = decrypt_cookie_linux()
    for token in tokens:
        auth = slack_api("auth.test", token, cookie)
        if auth.get("ok"):
            return token, cookie, auth
    print("❌ No working Slack token found")
    sys.exit(1)


# ─── User / channel helpers ────────────────────────────────────────────────

def find_user_by_name(token, cookie, display_name):
    """Find a user ID by display name (exact then partial match)."""
    result = slack_api("users.list", token, cookie)
    if not result.get("ok"):
        return None

    search = display_name.lower()
    for member in result["members"]:
        name = member.get("real_name", "").lower()
        display = member.get("profile", {}).get("display_name", "").lower()
        username = member.get("name", "").lower()
        if search in (name, display, username):
            return member["id"]

    for member in result["members"]:
        name = member.get("real_name", "").lower()
        display = member.get("profile", {}).get("display_name", "").lower()
        username = member.get("name", "").lower()
        if search in name or search in display or search in username:
            return member["id"]

    return None


# ─── Channel cache ────────────────────────────────────────────────────────────

def _load_channel_cache():
    """Load cached channel name→id mapping. Returns (cache_dict, timestamp) or ({}, 0)."""
    if not CHANNEL_CACHE_FILE.exists():
        return {}, 0
    try:
        data = json.loads(CHANNEL_CACHE_FILE.read_text())
        return data.get("channels", {}), data.get("ts", 0)
    except Exception:
        return {}, 0


def _save_channel_cache(channels: dict):
    """Persist channel name→id mapping to disk."""
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    CHANNEL_CACHE_FILE.write_text(json.dumps({"ts": time.time(), "channels": channels}, indent=2))


def _build_channel_cache(token, cookie):
    """Fetch all channels from Slack API and write to cache. Returns name→id dict.
    Saves whatever was fetched so far if a rate-limit error is hit mid-pagination."""
    # Start from the existing cache so partial refreshes don't lose known channels
    channels, _ = _load_channel_cache()
    try:
        for channel_type in ["public_channel", "private_channel"]:
            cursor = None
            while True:
                params = {"types": channel_type, "limit": 200, "exclude_archived": True}
                if cursor:
                    params["cursor"] = cursor
                result = slack_api("conversations.list", token, cookie, params)
                if not result.get("ok"):
                    break
                for ch in result.get("channels", []):
                    channels[ch["name"].lower()] = ch["id"]
                cursor = result.get("response_metadata", {}).get("next_cursor")
                if not cursor:
                    break
    except urllib.error.HTTPError as e:
        print(f"  ⚠️  Channel list fetch stopped early ({e.code}). Saving {len(channels)} channels fetched so far.", file=sys.stderr)
    _save_channel_cache(channels)
    print(f"  📦 Channel cache updated ({len(channels)} channels → {CHANNEL_CACHE_FILE})", file=sys.stderr)
    return channels


def resolve_channel(token, cookie, target, *, force_refresh=False):
    """Resolve a target (user name, channel name, or channel ID) to (channel_id, label)."""
    # Direct channel/DM/group IDs — skip all lookups
    if target.startswith(("C", "D", "G")) and len(target) > 8:
        return target, target

    # Try DM by user name first
    user_id = find_user_by_name(token, cookie, target)
    if user_id:
        dm = slack_api("conversations.open", token, cookie, {"users": user_id})
        if dm.get("ok"):
            return dm["channel"]["id"], f"DM with {target}"

    name = target.lower().lstrip("#")

    # 1. Try cache (if fresh enough)
    if not force_refresh:
        cached, ts = _load_channel_cache()
        age = time.time() - ts
        if cached and age < CHANNEL_CACHE_TTL:
            if name in cached:
                return cached[name], f"#{name}"
            # Cache is fresh but channel not found — try a refresh once
            force_refresh = True

    # 2. Build / refresh cache from API
    channels = _build_channel_cache(token, cookie)
    if name in channels:
        return channels[name], f"#{name}"

    return None, None


def get_users_map(token, cookie):
    """Build a user ID -> display name map."""
    result = slack_api("users.list", token, cookie)
    if not result.get("ok"):
        return {}
    users = {}
    for member in result["members"]:
        display = member.get("profile", {}).get("display_name") or member.get("real_name") or member.get("name", "")
        users[member["id"]] = display
    return users


# ─── Commands ───────────────────────────────────────────────────────────────

def cmd_send(args):
    """Send one or more text messages to a user or channel."""
    token, cookie, auth = get_auth()
    print(f"Authenticated as: {auth['user']} @ {auth['team']}")

    channel_id, label = resolve_channel(token, cookie, args.target, force_refresh=getattr(args, "refresh_cache", False))
    if not channel_id:
        print(f"❌ Could not find: {args.target}")
        print("   Tip: use a channel ID directly (e.g. C051X3W5T8D) or run 'list' to refresh the cache.")
        sys.exit(1)
    print(f"Target: {label} ({channel_id})")

    for i, text in enumerate(args.messages, 1):
        for r in range(args.repeat):
            payload = {"channel": channel_id, "text": text}
            if args.thread_ts:
                payload["thread_ts"] = args.thread_ts
            result = slack_api("chat.postMessage", token, cookie, payload)
            rep_label = f" (repeat {r+1}/{args.repeat})" if args.repeat > 1 else ""
            if result.get("ok"):
                print(f"✅ Message {i}{rep_label} sent: {text[:80]}")
            else:
                print(f"❌ Message {i}{rep_label} failed: {result.get('error')}")


def cmd_send_file(args):
    """Upload file(s) to a user or channel."""
    token, cookie, auth = get_auth()
    print(f"Authenticated as: {auth['user']} @ {auth['team']}")

    channel_id, label = resolve_channel(token, cookie, args.target, force_refresh=getattr(args, "refresh_cache", False))
    if not channel_id:
        print(f"❌ Could not find: {args.target}")
        print("   Tip: use a channel ID directly (e.g. C051X3W5T8D) or run 'list' to refresh the cache.")
        sys.exit(1)
    print(f"Target: {label} ({channel_id})")

    for i, filepath in enumerate(args.files):
        filepath = Path(filepath)
        if not filepath.exists():
            print(f"❌ File not found: {filepath}")
            continue

        file_size = filepath.stat().st_size
        filename = filepath.name
        print(f"  Uploading: {filename} ({file_size:,} bytes)")

        params = urllib.parse.urlencode({"filename": filename, "length": file_size})
        req = urllib.request.Request(
            f"https://slack.com/api/files.getUploadURLExternal?{params}",
            headers={"Authorization": f"Bearer {token}", "Cookie": f"d={cookie}"},
        )
        with urllib.request.urlopen(req) as resp:
            step1 = json.loads(resp.read())
        if not step1.get("ok"):
            print(f"  ❌ getUploadURLExternal failed: {step1}")
            continue

        upload_url = step1["upload_url"]
        file_id = step1["file_id"]

        if ".." in str(filepath):
            raise Exception("Invalid file path")
        with open(filepath, "rb") as f:
            file_data = f.read()

        boundary = "----SlackToolsBoundary"
        body = (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
            f"Content-Type: application/octet-stream\r\n\r\n"
        ).encode() + file_data + f"\r\n--{boundary}--\r\n".encode()

        req = urllib.request.Request(
            upload_url,
            data=body,
            headers={
                "Content-Type": f"multipart/form-data; boundary={boundary}",
                "Authorization": f"Bearer {token}",
                "Cookie": f"d={cookie}",
            },
            method="POST",
        )
        with urllib.request.urlopen(req) as resp:
            resp.read()

        complete_data = {"files": [{"id": file_id, "title": filename}], "channel_id": channel_id}
        msg = args.message if (i == 0 and args.message) else None
        if msg:
            complete_data["initial_comment"] = msg

        step3 = slack_api("files.completeUploadExternal", token, cookie, complete_data)
        if step3.get("ok"):
            print(f"  ✅ File shared: {filename}")
        else:
            print(f"  ❌ completeUploadExternal failed: {step3}")


def cmd_read(args):
    """Read messages from a channel or DM."""
    token, cookie, auth = get_auth()
    print(f"Authenticated as: {auth['user']} @ {auth['team']}")

    users_map = get_users_map(token, cookie)
    channel_id, label = resolve_channel(token, cookie, args.target, force_refresh=getattr(args, "refresh_cache", False))
    if not channel_id:
        print(f"❌ Could not find: {args.target}")
        print("   Tip: use a channel ID directly (e.g. C051X3W5T8D) or run 'list' to refresh the cache.")
        sys.exit(1)
    print(f"📺 {label} ({channel_id})\n")

    result = slack_api("conversations.history", token, cookie, {"channel": channel_id, "limit": args.limit})
    if not result.get("ok"):
        print(f"❌ Error: {result.get('error')}")
        return

    messages = result.get("messages", [])
    messages.reverse()

    for msg in messages:
        user_id = msg.get("user", msg.get("bot_id", "unknown"))
        username = users_map.get(user_id, user_id)
        ts = datetime.fromtimestamp(float(msg["ts"])).strftime("%Y-%m-%d %H:%M:%S")
        text = msg.get("text", "")
        reply_count = msg.get("reply_count", 0)
        thread_str = f" [💬 {reply_count} replies]" if reply_count else ""
        print(f"[{ts}] {msg['ts']} {username}:{thread_str}")
        print(f"  {text}")
        for f in msg.get("files", []):
            print(f"    📎 {f.get('name', 'file')} ({f.get('mimetype', '?')}, {f.get('size', 0):,} bytes)")
        print()

    print(f"--- {len(messages)} message(s) ---")


def cmd_thread(args):
    """Read a thread."""
    token, cookie, auth = get_auth()
    users_map = get_users_map(token, cookie)
    channel_id, label = resolve_channel(token, cookie, args.target, force_refresh=getattr(args, "refresh_cache", False))
    if not channel_id:
        print(f"❌ Could not find: {args.target}")
        print("   Tip: use a channel ID directly (e.g. C051X3W5T8D) or run 'list' to refresh the cache.")
        sys.exit(1)
    print(f"📺 {label} ({channel_id})\n")

    result = slack_api("conversations.replies", token, cookie, {
        "channel": channel_id, "ts": args.thread_ts, "limit": args.limit,
    }, use_get=True)
    if not result.get("ok"):
        print(f"❌ Error: {result.get('error')}")
        return

    for msg in result.get("messages", []):
        user_id = msg.get("user", msg.get("bot_id", "unknown"))
        username = users_map.get(user_id, user_id)
        ts = datetime.fromtimestamp(float(msg["ts"])).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] {username}:")
        print(f"  {msg.get('text', '')}")
        print()

    print(f"--- {len(result.get('messages', []))} message(s) in thread ---")


def cmd_search(args):
    """Search messages across all channels."""
    token, cookie, auth = get_auth()
    print(f"Authenticated as: {auth['user']} @ {auth['team']}\n")
    print(f'Searching for: "{args.query}"\n')

    params = urllib.parse.urlencode({"query": args.query, "count": args.limit})
    req = urllib.request.Request(
        f"https://slack.com/api/search.messages?{params}",
        headers={"Authorization": f"Bearer {token}", "Cookie": f"d={cookie}"},
    )
    with urllib.request.urlopen(req) as resp:
        result = json.loads(resp.read())

    if not result.get("ok"):
        print(f"❌ Search error: {result.get('error')}")
        return

    matches = result.get("messages", {}).get("matches", [])
    for match in matches:
        username = match.get("username", "unknown")
        channel_name = match.get("channel", {}).get("name", "?")
        ts = datetime.fromtimestamp(float(match["ts"])).strftime("%Y-%m-%d %H:%M:%S")
        print(f"[{ts}] {username} in #{channel_name}:")
        print(f"  {match.get('text', '')}")
        print()
    print(f"--- {len(matches)} result(s) ---")


def cmd_list(args):
    """List channels (also refreshes the local channel cache)."""
    token, cookie, auth = get_auth()
    print(f"Authenticated as: {auth['user']} @ {auth['team']}\n")

    channels = {}
    cursor = None
    while True:
        params = {"types": args.type, "limit": 200, "exclude_archived": True}
        if cursor:
            params["cursor"] = cursor
        result = slack_api("conversations.list", token, cookie, params)
        if not result.get("ok"):
            print(f"❌ Error: {result.get('error')}")
            break
        for ch in result.get("channels", []):
            channels[ch["name"].lower()] = ch["id"]
            member_count = ch.get("num_members", "?")
            purpose = ch.get("purpose", {}).get("value", "")[:60]
            prefix = "🔒" if ch.get("is_private") else "#"
            print(f"  {prefix} {ch['name']} ({member_count} members) - {purpose}")
        cursor = result.get("response_metadata", {}).get("next_cursor")
        if not cursor:
            break
    if channels:
        _save_channel_cache(channels)
        print(f"\n  📦 Channel cache updated ({len(channels)} channels)")


# ─── Main ───────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Slack CLI tool")
    subparsers = parser.add_subparsers(dest="command", required=True)

    # send
    p = subparsers.add_parser("send", help="Send text message(s)")
    p.add_argument("target", help="User display name, channel name, or channel ID")
    p.add_argument("messages", nargs="+", help="Message text(s) to send")
    p.add_argument("-r", "--repeat", type=int, default=1, help="Repeat each message N times (default: 1)")
    p.add_argument("--thread-ts", default=None, help="Thread timestamp to reply in a thread")
    p.add_argument("--refresh-cache", action="store_true", help="Force refresh of the channel cache before resolving")

    # send-file
    p = subparsers.add_parser("send-file", help="Upload file(s)")
    p.add_argument("target", help="User display name, channel name, or channel ID")
    p.add_argument("files", nargs="+", help="File path(s) to upload")
    p.add_argument("-m", "--message", help="Message to include with the first file")
    p.add_argument("--refresh-cache", action="store_true", help="Force refresh of the channel cache before resolving")

    # read
    p = subparsers.add_parser("read", help="Read messages from a channel or DM")
    p.add_argument("target", help="User display name, channel name, or channel ID")
    p.add_argument("-n", "--limit", type=int, default=20, help="Number of messages (default: 20)")
    p.add_argument("--refresh-cache", action="store_true", help="Force refresh of the channel cache before resolving")

    # thread
    p = subparsers.add_parser("thread", help="Read a thread")
    p.add_argument("target", help="User display name, channel name, or channel ID")
    p.add_argument("thread_ts", help="Thread timestamp")
    p.add_argument("-n", "--limit", type=int, default=50, help="Number of replies (default: 50)")
    p.add_argument("--refresh-cache", action="store_true", help="Force refresh of the channel cache before resolving")

    # search
    p = subparsers.add_parser("search", help="Search messages")
    p.add_argument("query", help="Search query")
    p.add_argument("-n", "--limit", type=int, default=20, help="Number of results (default: 20)")

    # list
    p = subparsers.add_parser("list", help="List channels")
    p.add_argument("-t", "--type", default="public_channel,private_channel", help="Channel types")

    args = parser.parse_args()

    commands = {
        "send": cmd_send,
        "send-file": cmd_send_file,
        "read": cmd_read,
        "thread": cmd_thread,
        "search": cmd_search,
        "list": cmd_list,
    }
    commands[args.command](args)


if __name__ == "__main__":
    main()

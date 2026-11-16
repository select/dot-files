---
name: agent-browser
description: Fast browser automation CLI for AI agents using accessibility-tree snapshots with compact @eN refs. Use for navigating pages, clicking, filling forms, mouse/drag interactions, extracting text, and taking screenshots.
---

# agent-browser

`agent-browser` drives Chrome (or any CDP endpoint via `--cdp <port>`) from the CLI. A snapshot returns the page's accessibility tree with compact `@eN` refs that you act on directly.

## Session isolation

Always pass a dedicated `--session <name>` on every command (each `bash` call is a separate shell, so avoid relying on `export AGENT_BROWSER_SESSION`). Always `close` the session when done.

```bash
agent-browser --session my-task open <url>
agent-browser --session my-task snapshot -i -c
agent-browser --session my-task click @e3
agent-browser --session my-task close
```

## Core commands

| Command | Purpose |
| --- | --- |
| `open <url>` | Navigate to URL (launches headless Chrome automatically) |
| `snapshot -i -c` | Compact interactive accessibility tree with `@eN` refs (`-d <n>` limits depth) |
| `click <sel\|@ref>` | Click element |
| `fill <sel\|@ref> <text>` | Clear and fill input |
| `type <sel\|@ref> <text>` | Type into element |
| `press <key>` | Press key (`Enter`, `Tab`, `Control+a`) |
| `wait <sel\|ms\|--text "...">` | Wait for selector, milliseconds, or visible text |
| `get <text\|title\|url\|box> [sel]` | Read text, title, URL, or bounding box (`x`, `y`, `width`, `height`) |
| `eval <js>` | Evaluate JavaScript and return JSON |
| `mouse move <x> <y>` / `down` / `up` | Pointer control for canvas/SVG drag selections |
| `screenshot [path]` | Save PNG screenshot (`--full` for full page, `--annotate` for numbered labels) |
| `close` | Close the browser session |

## Tips

- **Prefer `snapshot -i -c` over screenshots** for discovering elements; only take a screenshot when visually verifying or when requested.
- **Canvas / SVG drag selection:** Use `eval` or `get box <sel>` to get element coordinates (`getBoundingClientRect()`), then `mouse move <x1> <y1>`, `mouse down`, `mouse move <x2> <y2>`, `mouse up`.
- **Website blocked by anti-bot / JS challenge?**
  - For read-only content, use `web_fetch` (Lightpanda) directly—it has a non-Chrome fingerprint and passes sites like Reddit, OpenAI, and Amazon.de with lower overhead.
  - For interactive browsing when headless Chrome is blocked (e.g. Reddit), run Lightpanda as a CDP backend:
    ```bash
    lightpanda serve --host 127.0.0.1 --port 9223 &
    agent-browser --session my-task --cdp 9223 open <url>
    ```
  - For strict Cloudflare Turnstile/WAF pages that need full Chrome APIs (e.g. `openai.com`), use `--headed` or `--auto-connect` to reuse a logged-in Chrome session.
- **Full reference:** Run `agent-browser skills get core` or `agent-browser skills get core --ref commands` if you need advanced flags.

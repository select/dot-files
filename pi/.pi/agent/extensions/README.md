# Pi Agent Extensions

Custom extensions and configuration for the pi coding agent.

## Files

| File | Purpose |
|------|---------|
| `guardrails.json` | Guardrail rules for `@aliou/pi-guardrails` package |
| `protected-files.json` | List of files protected from accidental modification |
| `protected-files.ts` | Extension enforcing protected-files policy |
| `web-fetch.ts` | Extension adding web fetch capability |

---

## Known Issues & Fixes

### `pi-powerline-footer` — `nerd` preset crashes with "Unknown theme color: primary"

**Date:** 2026-03-07  
**Package:** `npm:pi-powerline-footer`  
**Affected presets:** `nerd`, `full` (any preset that renders `token_in` / `token_out` segments)

**Symptom:**

```
Error: Unknown theme color: primary
    at Proxy.fg (theme.js:274:19)
    at applyColor (pi-powerline-footer/theme.ts:125:16)
    at Object.render (pi-powerline-footer/segments.ts:216:23)
```

**Root cause:**

`presets.ts` in `pi-powerline-footer` defines `NERD_COLORS` with:

```typescript
tokens: "primary",  // ← invalid
```

`"primary"` is not a pi `ThemeColor` key — it's a user-defined var name that only exists inside a theme's `vars` block and is resolved at theme-load time. Pi's `theme.fg()` only accepts the 51 fixed color keys (`accent`, `muted`, `dim`, `error`, etc.).

The `nerd` preset uses `NERD_COLORS` and includes `token_in`/`token_out` segments, so rendering those segments calls `theme.fg("primary", text)` → crash.

> **Not caused by the pywal theme.** `pywal.json` and `pi-theme.py` are correct and only use valid pi theme color keys.

**Manual fix applied to installed package:**

In `~/.nvm/versions/node/v24.14.0/lib/node_modules/pi-powerline-footer/presets.ts`:

```diff
- tokens: "primary",
+ tokens: "accent",
```

Same fix applied to `theme.example.json` (`"model"` and `"cost"` also referenced `"primary"`).

**Workaround (without patching):** Switch back to a working preset inside pi:

```
/powerline default
```

---

### `pi-powerline-footer` — Rounded input box design

**Date:** 2026-03-07
**Package:** `npm:pi-powerline-footer`

**Change:** Replaced the separate status bar + plain horizontal rules with a compact rounded bracket design:

```
╭─ model │ thinking:med │ path │ git ─────────
╰ your input here
  continuation lines
```

**What changed:**

1. **Merged status bar into top border** — Status segments now render inside the `╭─...` top border line instead of a separate line above it. Saves 1 line of vertical space.
2. **Removed bottom border** — The `╰` on the prompt line is the closing corner. Saves another line of vertical space.
3. **Removed `>` prompt character** — Prompt prefix is now just `╰ ` (2 chars) instead of `╰> ` (3 chars), giving 1 extra char of content width.
4. **Custom border color** — Border characters (`╭`, `─`, `╰`) use a muted dark blue-grey (`rgb(80, 80, 100)`) instead of the theme's `sep` color.

**Files modified:**

`~/.nvm/versions/node/v24.14.0/lib/node_modules/pi-powerline-footer/index.ts` — editor render override (lines ~622–670)

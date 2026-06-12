# Pi LSP Packages Analysis

> Packages from https://pi.dev/packages (npm keyword: `pi-package`) that implement LSP functionality.
> Analyzed: 2026-03-09

---

## Packages Found

| Package | npm | Version | Source |
|---------|-----|---------|--------|
| `lsp-pi` | [npmjs](https://www.npmjs.com/package/lsp-pi) | 1.0.3 | no public repo listed |
| `pi-hooks` | [npmjs](https://www.npmjs.com/package/pi-hooks) | 1.0.3 | bundles `lsp-pi` code verbatim |
| `@yofriadi/pi-lsp` | [npmjs](https://www.npmjs.com/package/@yofriadi/pi-lsp) | 1.16.11 | [github.com/yofriadi/pi-extensions](https://github.com/yofriadi/pi-extensions/tree/main/packages/lsp) |

> **Note:** `pi-hooks/lsp/` is a verbatim copy of `lsp-pi` (byte-for-byte identical `lsp-core.ts` and `lsp.ts`).
> They are effectively the same package — `pi-hooks` just bundles it alongside other extensions (checkpoint, permission, ralph-loop, repeat, token-rate).

---

## 1. `lsp-pi` / `pi-hooks` (lsp sub-extension)

### Overview

Full-featured LSP client that ships two separate pi extensions:

| File | Role |
|------|------|
| `lsp.ts` | **Hook** — auto-diagnostics (runs after every `write`/`edit` or once at agent end) |
| `lsp-tool.ts` | **Tool** — on-demand LSP queries the agent can call explicitly |
| `lsp-core.ts` | Shared `LSPManager` class: spawns servers, manages JSON-RPC, caches diagnostics |

### Trigger Mechanism

**The hook is automatically triggered — no agent tool call required.**

It hooks into the `tool_result` event for `write` and `edit` tools:

```typescript
// lsp.ts
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName !== "write" && event.toolName !== "edit") return;
  // ...runs diagnostics automatically
});
```

Two modes (configurable via `/lsp` command):

| Mode | Trigger | Behavior |
|------|---------|----------|
| `agent_end` (default) | `agent_end` event | Collects all files touched during the full turn, sends one diagnostics message at the end via `pi.sendMessage({ triggerTurn: true, deliverAs: "followUp" })` |
| `edit_write` | `tool_result` event | Appends diagnostic output directly to the tool result content after every `write`/`edit` |
| `disabled` | Never | Hook disabled; tool still works |

In `agent_end` mode, the diagnostics message re-triggers a new agent turn (via `triggerTurn: true`), so the agent can act on errors without being explicitly asked.

### Supported LSPs

| Language | Server binary | Project root detection |
|----------|---------------|----------------------|
| TypeScript / JavaScript / JSX / TSX / MJS / CJS / MTS / CTS | `typescript-language-server` | `package.json`, `tsconfig.json`, `jsconfig.json` |
| Vue | `vue-language-server` | `package.json`, `vite.config.ts/.js` |
| Svelte | `svelteserver` | `svelte.config.js` |
| Dart / Flutter | `dart language-server` | `pubspec.yaml`, `analysis_options.yaml` |
| Python | `pyright-langserver` | `pyproject.toml`, `setup.py`, `requirements.txt`, `pyrightconfig.json` |
| Go | `gopls` | `go.work`, `go.mod` |
| Kotlin / KTS | `kotlin-lsp` (JetBrains, preferred) or `kotlin-language-server` | `settings.gradle(.kts)`, `build.gradle(.kts)`, `gradlew`, `pom.xml` |
| Swift | `sourcekit-lsp` (or via `xcrun`) | `Package.swift`, `*.xcodeproj`, `*.xcworkspace` |
| Rust | `rust-analyzer` | `Cargo.toml` |

### Tool Actions (on-demand via `lsp` tool)

```
definition          → jump to definition (file + line/col or query)
references          → find all references
hover               → type/docs at position
symbols             → document symbols list (optional query filter)
diagnostics         → single-file diagnostics (optional severity filter)
workspace-diagnostics → multi-file diagnostics (files array)
signature           → function signature help
rename              → rename symbol across files (requires newName)
codeAction          → quick fixes / refactors at position
```

### Architecture Details

- **Singleton `LSPManager`** per `cwd`: one LSP subprocess per `(serverId, projectRoot)` pair, reused across turns
- LRU eviction: max 30 open files per server; idle files closed after 60s
- **Auto-warmup** on `session_start`: detects project type from marker files (`pubspec.yaml` → Dart, `package.json` → TS, etc.) and pre-starts the LSP
- Both push diagnostics (`textDocument/publishDiagnostics`) and pull diagnostics (`textDocument/diagnostic` / `workspace/diagnostic`) are supported
- LSP servers shut down 2 minutes after last agent activity (restart lazily)
- Custom message renderer `lsp-diagnostics` for TUI display

### Install

```bash
pi install npm:lsp-pi
# or
pi install npm:pi-hooks
pi config  # enable lsp and lsp-tool extensions
```

---

## 2. `@yofriadi/pi-lsp`

### Overview

A more modular, framework-style LSP scaffold. Single extension entry point, but internally split into clean layers:

| File | Role |
|------|------|
| `src/index.ts` | Extension entry point — wires everything together |
| `src/client/runtime.ts` | Single-server LSP client lifecycle + JSON-RPC |
| `src/client/registry.ts` | Multi-server orchestrator: starts/stops servers, routes requests by file type |
| `src/config/resolver.ts` | Config file resolution (`lsp.json`/`lsp.yaml` in `~/.pi/agent/` or `.pi/`) |
| `src/tools/lsp-tool.ts` | Registers `lsp` and `lsp_health` tools |
| `src/hooks/writethrough.ts` | Auto format-on-write + diagnostics-on-write hook |

### Trigger Mechanism

**The write-through hook is automatically triggered — no agent tool call required.**

It listens on the `tool_result` event for `write` and `edit`:

```typescript
// src/hooks/writethrough.ts
pi.on("tool_result", async (event, ctx) => {
  if (event.toolName !== "write" && event.toolName !== "edit") return;
  // 1. Runs textDocument/formatting → applies edits to disk
  // 2. Fetches textDocument/diagnostic → shows summary notification
});
```

This is **always-on** (no mode switching): every successful `write` or `edit` call automatically:
1. **Formats** the file via `textDocument/formatting` and writes the formatted result back to disk
2. **Fetches diagnostics** via `textDocument/diagnostic` and shows a UI notification summary

### Supported LSPs

**Not hardcoded** — this package does NOT ship a built-in server catalog. Instead, it resolves servers from config files with auto-detection fallback:

**Config resolution order:**
1. `~/.pi/agent/lsp.json|yaml|yml` (user global)
2. `~/.pi/lsp.json|yaml|yml` (user fallback)
3. `.pi/lsp.json|yaml|yml` (project-level, overrides user)

**Auto-detection fallback** (probes these in order if no config found):
```
typescript-language-server
pyright-langserver
rust-analyzer
gopls
clangd
lua-language-server
```

Also **checks Neovim Mason bin dirs** (`~/.local/share/nvim/mason/bin`) before regular `$PATH`.

**Multi-server config example** (`.pi/lsp.yaml`):
```yaml
servers:
  ts:
    command: [typescript-language-server, --stdio]
    fileTypes: [.ts, .tsx, .js]
  python:
    command: [pyright-langserver, --stdio]
    fileTypes: [.py]
```

### Tool Actions (on-demand via `lsp` tool)

```
diagnostics         → single-file or all published diagnostics
definition          → jump to definition
references          → find all references
hover               → type/docs at position
symbols             → document or workspace symbols
rename              → rename symbol (requires newName)
status              → show server health
reload              → restart all LSP servers
```

Also exposes `lsp_health` as a backward-compat alias for `status`.

### Architecture Details

- **Multi-server aware**: a registry manages N named server instances, each with optional `fileTypes` routing
- Document-scoped requests route to the server matching the file's extension; workspace-scoped requests go to the first ready server
- Config is loaded from YAML or JSON; project config overrides user config
- Lifecycle: `session_start` → `runtime.start()`, `session_shutdown` → `runtime.stop()`
- `/lsp-status` slash command for health inspection
- **No built-in server catalog** — you must install and configure your own servers (or rely on the auto-probe fallback)

### Install

```bash
pi install npm:@yofriadi/pi-lsp
# or from git (monorepo):
pi install git:github.com/yofriadi/pi-extensions@lsp-v<version>
```

---

## Key Difference: Auto-Trigger vs. Agent-Called

This was the specific question: **is the LSP tool called automatically when a file is edited, or does the agent have to call it?**

| Package | Auto-trigger on write/edit? | How |
|---------|----------------------------|-----|
| `lsp-pi` / `pi-hooks` (hook mode `edit_write`) | ✅ Yes — agent never needs to call it | `pi.on("tool_result")` intercepts every `write`/`edit` result and appends diagnostics to the result content |
| `lsp-pi` / `pi-hooks` (hook mode `agent_end`, default) | ✅ Yes — at end of turn | `pi.on("agent_end")` collects all touched files and sends a new follow-up message (triggers new agent turn) |
| `@yofriadi/pi-lsp` (write-through) | ✅ Yes — always on | `pi.on("tool_result")` runs formatting + diagnostics for every successful `write`/`edit` result |
| `lsp-pi` `lsp-tool.ts` | ❌ No — agent must call `lsp` tool | Agent explicitly calls the `lsp` tool with an action |
| `@yofriadi/pi-lsp` `lsp-tool.ts` | ❌ No — agent must call `lsp` tool | Agent explicitly calls the `lsp` tool with an action |

**Answer: Both packages include hooks that fire automatically on `tool_result` events for `write`/`edit` — the agent does NOT need to call anything. The auto-trigger is the hook component, separate from the tool component.**

---

## Comparison Summary

| Feature | `lsp-pi` / `pi-hooks` | `@yofriadi/pi-lsp` |
|---------|----------------------|-------------------|
| Auto-trigger mechanism | `tool_result` → appends diagnostics (or queues for `agent_end`) | `tool_result` → format-on-write + diagnostic notification |
| Auto-format on write | ❌ No | ✅ Yes (via `textDocument/formatting`) |
| Configurable hook mode | ✅ Yes (`edit_write` / `agent_end` / `disabled`) | ❌ No (always on) |
| Built-in server catalog | ✅ 9 languages hardcoded | ❌ Config-file driven (6-entry fallback probe) |
| Multi-server routing | ❌ Implied by catalog | ✅ Explicit named servers with `fileTypes` |
| Config file support | ❌ No | ✅ `lsp.json`/`lsp.yaml` in `~/.pi/agent/` or `.pi/` |
| Mason (Neovim) path support | ❌ No | ✅ Yes |
| Workspace diagnostics | ✅ Yes (multiple files) | ❌ No (single file only) |
| Code actions | ✅ Yes | ❌ No |
| Signature help | ✅ Yes | ❌ No |
| Rename | ✅ Yes (both packages) | ✅ Yes |
| `/lsp-status` command | ❌ No | ✅ Yes |
| `/lsp` settings command | ✅ Yes (mode switcher) | ❌ No |
| Kotlin auto-download | ✅ Yes (JetBrains kotlin-lsp) | ❌ No |
| Dependencies | `vscode-languageserver-protocol` | `yaml` |

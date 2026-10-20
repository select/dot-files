# Self Compact — dotfiles integration

Vendored from [disler/self-compact-pi-agent](https://github.com/disler/self-compact-pi-agent),
commit `576fe4abda021849f5cde5b6f5796467ffa4bcbd` (MIT; see `LICENSE`).
Only the extension, prompts, and unit tests are vendored, not a nested Git checkout.
Upstream updates must be merged manually to preserve these local changes.

## Installation

Pi automatically loads this directory's `index.ts` from `~/.pi/agent/extensions/`.
No package declaration or launch flags are required.

Install the YAML parser after checking out the dotfiles:

```bash
cd pi/.pi/agent/extensions/self-compact
bun install --frozen-lockfile --ignore-scripts
```

Pi supplies its own runtime packages through its extension loader.
The directory and its sibling YAML file must both be linked into
`~/.pi/agent/extensions/` (e.g. using the repository's Stow setup).
Run `/reload` or restart Pi after installation.

## YAML limits

Edit **`pi/.pi/agent/extensions/self-compact.yaml`**, beside this directory:

```yaml
defaults:
  softAt: "30%"
  at: "50%"
  buffer: "10%"

models:
  "github-copilot/gpt-6-astra":
    at: "40%"
  "openrouter/deepseek/deepseek-v4.1-flash:nitro":
    softAt: "60k"
    at: "100k"
    buffer: "20k"
```

- `softAt`: context-usage notice; other tools remain available.
- `at`: asks the agent to finish its current atomic step, write its handoff note,
  and compact soon.
- `buffer`: allowance above `at` before other tools are blocked.
- **Hard cutoff = min(at + buffer, 90% of the model's context window).**
  `buffer: 0` enforces the cutoff immediately at the warning line.

Values accept quoted percentages (`"50%"`), whole tokens (`100000`),
or k/m suffixes (`"100k"`, `"1.5m"`). Percentages adapt to every model's
reported context window. Token limits that exceed the selected model's cap
are rejected; they are not silently clamped.

Overrides are exact, case-sensitive keys. Each field inherits independently:

1. `provider/modelId`, including any slashes or suffixes inside the model ID.
2. Bare `modelId`, if configured.
3. `defaults`.
4. Built-in fallback: `30% / 50% / 10%`.

No glob matching is performed. All models without an override use the shared
defaults. The YAML example above illustrates percentage-based settings.
The current trial configuration uses 200k / 300k / 350k tokens by default.
GitHub Copilot's GPT-6 Astra, GPT-6.1 Sol, and GPT-6 Luna use
180k / 250k / 272k (notice / warning / cutoff). Their forced cutoff matches
the published 272k input-token long-context price boundary, subject to the
90% context-window cap.
These are trial budgets, not vendor-prescribed optimal thresholds or guaranteed
per-request billing ceilings. The non-GPT defaults are context-hygiene budgets,
not claimed pricing boundaries.

Configuration is reread on startup, `/reload`, session/tree changes, and model
selection. Run **`/reload` after editing the YAML**.
Malformed YAML, duplicate/unknown keys, invalid value types, invalid ordering,
and out-of-window limits are reported and block tool execution until fixed.
A missing file uses the built-in fallback.

Keep notice/warning thresholds comfortably above Pi's retained recent history
(`compaction.keepRecentTokens`, normally 20k). This integration honors Pi's
per-model retained-history overrides too. If no history can be removed, the
extension does not engage the forced lock.

## Commands and tools

- `/self-compact-info`: config path, selected model, resolved limits, per-field
  config sources, usage, handoff state, and cycle count; no model turn.
- `/self-compact-now`: asks the agent to save its note and compact.
- `/compact`: manual compaction, using the same custom summary prompt.
- `view_context()`: model-visible context/threshold JSON.
- `self_compact({ note_to_self })`: saves a handoff note, ends the tool batch,
  compacts at the awaited turn boundary, and returns the note verbatim for continuation.

Both tools use `model-only` exposure: they stay directly callable even with
`codemode.mode: "only"`. Do not call them inside a codemode script.
At the hard cutoff, codemode and ordinary tools are blocked, but the direct
compaction tools remain available. This avoids a code-mode compaction deadlock.
The extension publishes unstyled snapshots via `self-compact:footer` on Pi's
event bus. Powerline renders the live usage, warning, and forced budget inside its
existing context segment, with cache-aware meter colors and responsive layout.
It requests an initial snapshot through `self-compact:footer-request`, so either
extension startup order works. No standalone `setStatus` gauge is displayed,
including during startup or when Powerline is disabled or absent. Use
`/self-compact-info` to inspect usage without Powerline. Model/session identity
prevents stale limits from being displayed after a switch.

As upstream, the extension intercepts native automatic compaction to defer it
to its handoff flow. Saved notes and locks survive failed/cancelled compaction
and session recovery. Manual `/compact` remains available.

### Run lifecycle (Pi 1.0.4)

Automatic self-compaction runs inside the awaited `turn_end` boundary, using the
active run's abort signal. The summary, verbatim handoff, and completed state are
returned as ordered boundary entries with `continue: true`. Retries are awaited
as well. Print/JSON mode therefore cannot shut down between saving the note and
continuing from it. `agent_settled` only refreshes the display; starting detached
`ctx.compact()` work there races single-shot shutdown. Calling `ctx.compact()`
inside `turn_end` would instead deadlock because it waits for that run to be idle.

Manual `/compact` and idle TUI recovery retain the native compaction hooks.
Cancellation or exhausted retries preserve the note and tool lock; non-UI modes
also report the failure on stderr. Resume the session and retry once the cause is
fixed. Cancellation does not automatically restart the agent.

`summary.ts` has one compatibility bridge to the **installed host's**
`dist/core/compaction/compaction.js`: Pi 1.0.4 does not re-export its preparation
function from the public package root. This preserves native context edits,
retained history, split turns, and file tracking rather than duplicating them.
Run the real-host tests after upgrading Pi. An incompatible host fails closed,
keeping the saved note rather than silently using different compaction semantics.

## Prompts

Editable prompt files live in `prompts/`. Project overrides in
`<cwd>/.pi/self-compact/` take precedence. Prompt files are read fresh on use.
The upstream optional `--compact-prompt` literal summary override is retained;
**threshold flags are removed**. Thresholds are configured only through YAML.

## Tests

```bash
cd pi/.pi/agent/extensions/self-compact
bun run test
PI_SELF_COMPACT_HOST=/path/to/node_modules/@earendil-works/pi-coding-agent \
  bun run test:runtime
```

Unit tests cover YAML parsing, inheritance, threshold math, prompts, and state
recovery. Runtime tests use the installed Pi extension loader and native
compaction with a fake summary response; no API calls or provider costs.
`tests/lifecycle.test.mjs` additionally exercises real `AgentSession` and
`runPrintMode` scheduling: text/JSON shutdown, interactive continuation, retries,
cancellation, interrupted-note recovery, and repeated compaction cycles. Only the
model transport is fake. The pre-fix regression exits with one model request and
no handoff while the summary is still running.
Runtime tests skip when `PI_SELF_COMPACT_HOST` is not set.

For comparison against a saved extension baseline, run the lifecycle test with
`PI_SELF_COMPACT_SOURCE=/path/to/baseline/self-compact`; it does not modify that copy.

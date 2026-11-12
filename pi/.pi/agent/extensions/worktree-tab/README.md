# Worktree → Herdr tab

Global Pi extension. No project configuration or shell wrapper required.

## Use

After adding/updating this extension, run `/reload` in the **original/source Pi
session before transferring** (or start a new Pi session). Copying files does not
update an already running extension. Reloading only the new tab cannot
retroactively submit a continuation for a transfer made with older code.

An idle fork showing the old handoff text "wait for the user's next instruction"
was created by the old extension. After inspecting it to ensure no work is
running, manually tell that tab to continue; do not repeat the transfer. If Pi is
waiting at a trust/permission dialog, answer it yourself; the extension never
approves dialogs automatically.

```text
/worktree
/worktree ../hub-EN-7102
/worktree /absolute/path/to/worktree
/worktree "../worktree with spaces"
```

With no argument, a picker lists this repository's other existing worktrees.
With an argument, use the worktree root. Relative paths resolve from Pi's current
working directory, not the shell's last `cd`. `~/` is supported. Worktrees must
already exist and belong to the same repository; the main checkout and detached
worktrees are supported too.

The command:

1. Forks the current conversation into a separately saved session associated with
   the selected worktree. Preserves the active branch, compaction, current model,
   and thinking level, and names the new session after the worktree directory.
2. Creates a labeled tab in the caller's Herdr workspace with that directory.
3. Starts Pi there with one **native CLI startup prompt** to resume the unfinished
   user-requested task, waits for Herdr readiness, and focuses the tab. Pi queues
   the prompt through its own startup path, not injected terminal keystrokes.
   Pi discovers the target directory's configuration and instructions. A successful
   launch confirms the startup prompt was supplied, not that the task finished or
   that a model request succeeded.
4. Leaves the original tab/session open. Stop working in the original tab after a
   successful transfer to avoid duplicate work.

A successful transfer is a fork, **not a live shared conversation**. Later messages
in either tab are independent. Uncommitted files are **not copied** between worktrees.
The model must re-check repository state in the target directory.

## Agent tool

`open_worktree_tab({ path, focus?: boolean, resume?: boolean })` provides the same
operation for an explicit natural-language request to carry the session to a
worktree in Herdr. `focus` and `resume` default to true. Set `focus: false` to leave
current focus alone (work still continues), or `resume: false` for an idle copy
that waits for input. `/worktree` always submits the continuation prompt.
A separate skill is unnecessary: the tool's description supplies its usage and
safety rules to Pi directly.

When called during an agent turn, the fork stops before any incomplete assistant
tool-call batch. This avoids copying unmatched tool calls or a partially completed
parallel batch. The initiating user request is retained, but this tool's result
and the assistant's later reply are not carried over. The new session includes a
handoff note so it won't repeat the transfer automatically. The continuation
prompt tells it to re-check instructions and repository state and resume only
already requested work. If no actionable task remains, it should ask what to do
next rather than invent work.

## Requirements and failure recovery

- Run inside Herdr with `HERDR_ENV=1` and inherited workspace/pane IDs.
- `HERDR_BIN_PATH` is preferred over looking up `herdr` in PATH.
- `pi` and `git` must be available to Herdr/the extension.
- The Pi session must be saved; `--no-session` cannot be transferred.
- The registered tool is intended only for explicit user-requested transfers,
  not automatic delegation or creating arbitrary background agents.

If startup fails, the error preserves the forked session path and any created
Herdr tab/pane IDs, with a shell-quoted recovery command. Inspect that tab before
retrying: a timeout does not prove Pi failed to start. Existing or partially
started tabs are never automatically closed. Startup already includes the
continuation, so the task may be running even when readiness confirmation fails.
Inspect that tab and its saved session before sending anything else; never blindly
repeat the transfer or continuation prompt. A failure to focus an already started
tab is reported as a warning, not a failed transfer.

The earlier `herdr agent prompt` implementation could acknowledge submission on
the devbox without Pi recording a user message or starting a turn
(`agent_prompt_stalled` with activity checking enabled). Like wait-for-event's
supervisor, this extension supplies its prompt as native `pi ... -- <prompt>`
arguments instead of relying on terminal-input delivery during startup.

Custom CLI-only flags from the original invocation are not duplicated; model and
thinking level are preserved, and all other settings/resources are discovered
normally from the new working directory. Worktree selection never grants project
trust automatically.

## Tests

```bash
node --test ~/.pi/agent/extensions/worktree-tab/tests/*.test.mjs
```

An optional live smoke test creates a **temporary** background tab, starts an idle
Pi with a test conversation, verifies it through Herdr, and closes only that tab:

```bash
HERDR_WORKTREE_LIVE_TEST=1 node --test \
  ~/.pi/agent/extensions/worktree-tab/tests/integration.test.mjs
```

To test actual continuation in a disposable Herdr tab, use a **local mock
provider**, with no model API calls. The fixture deliberately delays startup,
records `before_agent_start` and `agent_settled` to a test-only lifecycle log,
and returns `WORKTREE_CONTINUATION_OK`. The test verifies exactly one matching
continuation prompt and a saved assistant reply, independently of process exit
or Herdr's focus-dependent idle/done classification. It disables tools/MCP and
closes only its own tab. Existing sessions and focus are left alone:

```bash
HERDR_WORKTREE_CONTINUATION_TEST=1 node --test \
  ~/.pi/agent/extensions/worktree-tab/tests/integration.test.mjs
```

For an explicit **live model request**, set `HERDR_WORKTREE_TEST_PROVIDER` and
`HERDR_WORKTREE_TEST_MODEL` to an already authenticated model, for example:

```bash
HERDR_WORKTREE_CONTINUATION_TEST=1 \
HERDR_WORKTREE_TEST_PROVIDER=github-copilot HERDR_WORKTREE_TEST_MODEL=gpt-6.1-sol \
node --test ~/.pi/agent/extensions/worktree-tab/tests/integration.test.mjs
```

No login is performed by the test. Do not run the real-model variant as part of
provisioning.

In the devbox configuration checkout, the equivalent tasks are:

```bash
task agent:worktree-tab:test               # offline
task agent:worktree-tab:test-live          # live startup, no model request
task agent:worktree-tab:test-continuation  # live Herdr + mock model, no tools
```

The integration tests resolve the SDK from the installed `pi` executable
(including pnpm cmd-shims); `PI_SDK_ROOT` can override the SDK package directory.
No additional Pi copy or npm install is needed. Default tests use synthetic
sessions and mock process execution; the optional startup smoke test uses
`resume: false`. The continuation fixture is loaded explicitly only in its test
process, never as part of normal provisioning or normal Pi sessions.

# Wait for an external event

Generic, one-shot background waits for Pi. A skill tells the agent to call
`wait_for_event`, which arms a waiter and returns `terminate: true`. Pi ends the
agent turn instead of repeatedly asking the model to poll. When the event arrives,
the extension sends its result with `triggerTurn: true` and resumes the conversation.

No model calls are made by the waiter. Optional idle cache-warming requests are
suppressed while a wait is active. Other extensions or manually submitted prompts
can still trigger turns; this is not a lock on the session.

## Load

This directory is discovered automatically under `~/.pi/agent/extensions/`.
After installing it or making changes, run `/reload`. Alternatively:

```bash
pi -e ~/Dev/dot-files/pi/.pi/agent/extensions/wait-for-event/index.ts
```

Keep Pi open in interactive or RPC mode. Print and JSON modes are rejected because
they exit after the agent turn.

## Use from a skill

Add instructions like these to the skill's `SKILL.md`:

> When the task needs to wait for an external event, call `wait_for_event` once,
> as the **only tool call in the assistant message**. Do not loop with bash/sleep
> or perform extra work while waiting. Provide a descriptive `label`, a foreground
> watcher `command` with `args` (or a unique event `file`), a `timeoutSeconds`
> deadline, and a `resumePrompt` describing the next action. On wake-up, inspect
> the exit code/event data. A nonzero exit, timeout, or waiter error is not success.

### Choose exactly one mode

- **FILE:** a process already writes a completion/status file (for example an AWS
  login running in tmux). Send `label`, `file`, and any deadline/continuation.
  **Omit `command` and `args`, or set both to `null`**; do not send empty
  strings/arrays or add a shell polling loop.
- **COMMAND:** the extension should launch a foreground watcher and wait for it
  to exit. Send `label`, `command`, and optional `args`. **Omit `file` or set it
  to `null`**. Never invent a placeholder path such as `/tmp/not-used`.

Never combine non-null `command` and `file`. A validation error means **no wait
was armed**. Read the error's corrected arguments and repair the call instead of
repeating it. For conflicting modes, the error offers both alternatives; choose
based on whether you need to launch a watcher or already have a real file producer.
The tool does not silently choose between conflicting modes or launch a command
from a rejected call.

Some providers require every schema property to be present, even optional ones.
All optional fields accept `null`, which behaves like omission (including defaults
for `cwd`, `timeoutSeconds`, and `resumePrompt`). For example, this all-fields-present
command call is valid:

```json
{
  "label": "Shared UI CI",
  "command": "gh",
  "args": ["pr", "checks", "218", "--repo", "apheris/user-interface", "--watch"],
  "file": null,
  "cwd": null,
  "timeoutSeconds": 900,
  "resumePrompt": "Inspect the CI outcome and report failures or completion."
}
```

`label` remains required and non-null. Empty strings are not a substitute for
`null`, and file mode still rejects an `args` array (even an empty one).

For a login already running in tmux and writing a unique exit-status file:

```json
{
  "label": "AWS login for Bedrock review",
  "file": "/tmp/unique-login.exit",
  "timeoutSeconds": 300,
  "resumePrompt": "Inspect the login exit status. If successful, verify the exact requested Bedrock model; otherwise diagnose the login failure."
}
```

### Foreground watcher command

For example, after obtaining the GitHub Actions **run ID** for the commit you pushed:

```json
{
  "label": "CI for commit abc123",
  "command": "gh",
  "args": ["run", "watch", "123456789", "--repo", "owner/repo", "--exit-status", "--interval", "15"],
  "timeoutSeconds": 3600,
  "resumePrompt": "CI finished. Inspect the run result. If it failed, fetch the failed logs and fix the problem; if it passed, report completion."
}
```

Pass this object to the `wait_for_event` tool. The extension is not GitHub-specific:
any executable that stays running until its event occurs works. A skill's watcher
script can poll an API in ordinary code without involving the agent/model.

Commands run **without a shell**. Arguments are literal, stdin is closed, and the
working directory defaults to the session directory. Supply `cwd` to override it.
Executable paths and `cwd`/`file` paths support a leading `~/`; arguments do not.
To deliberately use shell syntax:

```json
{
  "label": "Deployment ready",
  "command": "bash",
  "args": ["-c", "exec ./scripts/watch-deployment.sh staging"],
  "resumePrompt": "Read the deployment result and continue the smoke test."
}
```

Do **not** pass `nohup`, `&`, or a script that launches a detached worker and exits.
The wake-up event is the foreground command's exit, not the detached worker's exit.
A script must be non-interactive and eventually exit. A command that exits with
any status (including failure) wakes the agent once, with its exit code and the
last 24,000 characters of combined stdout/stderr. No automatic retry happens.
The direct command's `exit` triggers completion even if a descendant keeps its
output pipes open. Remaining output drains for up to 250 ms (or until pipe closure,
whichever comes first); output arriving later is not captured. Successful command
completion does not terminate independent descendants.

### Event file written by an external process

Use this when a skill already launches its own watcher or a webhook receiver
needs to notify the session:

```json
{
  "label": "External CI result",
  "file": "/tmp/pi-ci-abc123-unique-token.txt",
  "timeoutSeconds": 3600,
  "resumePrompt": "Inspect this CI result and continue the task."
}
```

The waiter checks the file once per second in ordinary code. It wakes when a
regular text file exists and its first 24,000 bytes contain non-whitespace text.
The file can be missing or empty when armed. A non-empty file already present
triggers immediately, so use a **unique path per wait** to avoid stale events.
Choose a private directory when event contents are sensitive.

The producer should write to a temporary file in the same directory and rename
it atomically onto the event path, so the agent does not wake on partial output:

```bash
# Example producer, after its watcher finishes:
printf '%s\n' 'CI completed: all checks passed' > "$EVENT_FILE.tmp"
mv -- "$EVENT_FILE.tmp" "$EVENT_FILE"
```

The extension only reads files; it never clears or deletes them. File contents
are delivered as untrusted event data, not continuation instructions. The
trusted continuation instruction comes from `resumePrompt`.

## Reliable Pi subagents

**Do not use Pi process exit or a model-written sentinel as the completion signal.**
A finished run can leave a worker, extension or shutdown handler alive. Instead,
use `scripts/supervise.ts` (Node 24). It runs Pi in JSON mode, continuously drains
stdout/stderr and atomically publishes `completion.json` on **`agent_settled`**,
before attempting process cleanup. `agent_end` or a final assistant message alone
is not sufficient: automatic recovery or queued work may still follow.

Write the task to an existing prompt file, then start the supervisor in a separate
terminal or tmux session. The run directory must **not already exist**:

```bash
RUN="$(mktemp -d /tmp/pi-worker.XXXXXXXX)/run"
printf 'Completion file: %s/completion.json\n' "$RUN"
# Replace the prompt path and model/provider with the intended worker settings.
tmux new-session -d -s my-worker \
  "node '$HOME/.pi/agent/extensions/wait-for-event/scripts/supervise.ts' \
    --run-dir '$RUN' --prompt-file '/absolute/path/to/task.txt' \
    --timeout-seconds 3600 -- --provider YOUR_PROVIDER --model YOUR_MODEL"
```

Then call `wait_for_event` in **FILE mode**, with the actual printed path:

```json
{
  "label": "Pi worker settled",
  "file": "/tmp/pi-worker.UNIQUE/run/completion.json",
  "timeoutSeconds": 3660,
  "resumePrompt": "Read completion.json. Inspect kind/outcome, the final report, logs and artifacts before deciding whether the task succeeded. Do not rerun paid operations blindly."
}
```

The example path is illustrative; never reuse it literally. The supervisor accepts
one prompt via `--prompt-file`, not extra positional prompts. After `--` it accepts
long-form model/tool/resource options (`--provider`, `--model`, `--thinking`,
`--tools`, `--exclude-tools`, `--extension`, `--skill`, `--append-system-prompt`,
`--system-prompt`, `--name`, `--no-mcp`, `--no-extensions`, `--no-skills`,
`--no-prompt-templates`, `--no-themes`, `--no-context-files`, `--no-tools`,
`--no-builtin-tools`, `--offline`, `--approve`, and `--no-approve`).
It owns JSON mode and a fresh session at `RUN/session.jsonl`; mode, print, resume,
fork and session flags are rejected. Use a new run directory for each task.
`--help` displays the supervisor's invocation syntax.

Each private run directory contains:

- `run.json`: unique run ID, start time, cwd and session path.
- `events.jsonl` / `stderr.log`: complete protocol output and diagnostics.
- `session.jsonl`: the worker's persisted Pi session.
- `completion.json`: exactly one terminal record, published by same-directory
  atomic rename, sized to fit the waiter's file-read limit. It includes run/session
  identity, timestamps, `kind`, `outcome`, stop reason and bounded final text.
- `shutdown.json`: subsequent cleanup outcome, independent of completion.

Interpret the record explicitly:

- `kind: settled` means no automatic work remains. `outcome: completed` means a
  normal model stop, **not proof the requested work succeeded**. A blocker can be
  reported in a normal response. Verify the final report and artifacts.
- Settled model errors/aborts are `outcome: error` / `aborted`; other stop reasons
  are `unknown` (including a tool terminating the run).
- Exit before settling, startup/protocol errors, timeout or interruption produce
  `kind: exit`, `error`, `timeout` or `cancelled`, never a successful completion.
- Retries may produce intermediate errors; only the final settled state counts.

The default worker deadline is one hour (CLI range 1–86,400 seconds). Set the
parent wait slightly longer. After settling, Pi gets five seconds to exit, then
SIGTERM and two seconds before SIGKILL. Only the direct Pi process is signalled:
intentional preview servers survive, but leaked independent descendants may need
separate diagnosis. Output pipes are drained during cleanup, with bounded waiting
if descendants keep them open. SIGINT/SIGTERM to the supervisor publishes a
cancelled record and cleans up its child. SIGKILL, host failure or disk-full errors
cannot guarantee notification; keep the parent timeout as a backstop.

Logs/session files may contain sensitive tool output; the directory is private.
No secrets should be passed as command-line options. The supervisor makes no model
calls of its own, but its Pi worker executes the supplied task normally. It does
not export/publish artifacts or retry tasks automatically. Existing sessions are
left untouched.

## Manual commands

Start a wait while the agent is idle by supplying the same JSON object:

```text
/wait-event {"label":"demo","command":"bash","args":["-c","sleep 5; echo done"],"resumePrompt":"Say that the demo event arrived."}
/wait-event status
/wait-event cancel
```

`/wait-event status` reports the source path/command, elapsed time, deadline and
last observed state without starting a model turn.

The arming command does not start a model turn. Completion does. If the agent is
busy when an event arrives, the result is queued as a follow-up instead of
interrupting its current work.

## Lifecycle and limits

- One wait per session. A second wait is rejected until the first finishes or is cancelled.
- Default timeout: one hour. Allowed range: 1–86,400 seconds. Timeout wakes the
  agent with a timeout result, **not** a successful event result.
- Cancellation never triggers a model turn.
- Commands run with Pi's permissions and inherited environment, like ordinary
  local tools. No shell is used unless explicitly requested. This is a new
  execution surface: permission/guardrail rules must cover `wait_for_event`, not
  just `bash`. Do not include secrets in arguments or output; results enter the session.
- On cancellation/timeout/shutdown, Unix process groups receive SIGTERM followed
  by SIGKILL after two seconds. This covers ordinary descendants, not processes
  that deliberately daemonize. On Windows only the direct child is terminated.
- Quit, reload, session replacement, or tree navigation cancels the active waiter.
  **Waits do not survive closing Pi**, and commands are never replayed automatically
  after resume. A persisted interrupted-wait marker tells you to re-arm explicitly.
- Call the tool alone: Pi only honors a terminating tool batch when every tool
  in that batch returns `terminate: true`. `model-only` exposure keeps this tool
  directly available even when codemode hides ordinary tools.

## Tests

Requires Node 24 with native TypeScript stripping. No package installation is needed:

```bash
cd ~/Dev/dot-files/pi/.pi/agent/extensions/wait-for-event
bun run test
```

To also exercise loading, commands, session lifecycle, and wake-up delivery against
an installed Pi host, set `PI_WAIT_EVENT_HOST` to the installed
`@earendil-works/pi-coding-agent` **package directory** (the directory containing
`dist/`), then run the same command. Host-dependent tests are skipped without it.

The suites cover waiter delivery/lifecycle, command exit with inherited pipes,
supervisor CLI/protocol framing, crashes, deadlines, cancellation, duplicate
completion races and bounded shutdown. A host integration test runs the installed
`pi` executable with a local mock provider and deliberately hung shutdown, then
verifies that the parent file waiter wakes exactly once. No paid model requests
are made by these tests.

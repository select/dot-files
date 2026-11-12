---
name: gh-pr-notify
description: "Monitor GitHub PR checks/actions and notify when done, optionally also notifying a phone. Either launch a detached watcher and leave Pi, or wait without agent polling and resume to react to CI results. Use when: notify PR, watch PR checks, monitor CI, notify when checks pass, PR notification, notify my phone about PR checks, wait for CI and continue, fix CI when it finishes"
---

# Purpose

Monitor a GitHub Pull Request's CI check runs and send a desktop notification
(`notify-send`) when all registered check runs complete, reporting pass/fail.
When explicitly requested, also send the result through `phone-notify`; the
desktop notification is always attempted.

Support two distinct workflows:

- **Notify only:** launch a detached watcher. The user can close Pi and still
  receive the notification. Do not automatically resume the agent.
- **Wait and react:** use Pi's `wait_for_event` tool. The agent goes idle until
  the watcher finishes, then resumes with the result and the requested next action.
  Pi must remain open (interactive or RPC mode).

## Requirements and inputs

- `gh` installed and authenticated, plus `jq` and `notify-send`.
- `phone-notify` only when the user explicitly requests phone notification.
- `wait_for_event` from the `wait-for-event` extension for wait-and-react mode.
- PR identifier: full URL, `owner/repo#123`, or PR number with a repository.
  Detect the repository from the git remote or ask when it is unclear.
- Optional poll interval in positive integer seconds (default: 15).
- Optional wait-and-react deadline in seconds (default: 3600; maximum: 86400).

Resolve `scripts/gh-pr-notify.sh` relative to this `SKILL.md` directory and use
its **absolute path** in tool calls. `{baseDir}` below is a placeholder for that
absolute skill directory, not literal shell syntax.

## Mandatory preflight before launching or arming a wait

Run this synchronously with the actual PR/repository/interval, before either
workflow below (append `--phone` only if requested):

```bash
bash '{baseDir}/scripts/gh-pr-notify.sh' --preflight 1839 apheris/hub 15
```

Replace `{baseDir}` with the absolute skill directory. Require exit `0` and
`Preflight OK` before starting the watcher. On failure, show the diagnostics
and fix the setup; do not arm a wait or announce that monitoring is running.
Preflight checks required commands (`gh`, `jq`), installed CLI pagination support,
PR access/authentication, and a real check-runs API response. It neither waits
for CI nor sends notifications. The watcher repeats these checks at startup;
preflight success alone is not a CI result.

Compatibility: use `gh api … --paginate` and merge its JSON page stream with
`jq -s`. **Do not use `gh api --slurp`**: older installed CLIs lack that option.
Unsupported flags/options exit immediately. Other fetch failures get at most
three attempts per poll (two interval sleeps), then exit `3` with diagnostics.
Invalid JSON/page structure also exits `3`; it is not a CI failure. Successful
polls reset the retry budget. Pending or unregistered checks still wait normally
and are bounded by the wait-and-react deadline, not the fetch retry limit.

Regression tests (mocked CLI, no GitHub access or notifications):

```bash
node --test '{baseDir}/tests/watcher.test.mjs'
```

## Choose the mode

- “Notify me when checks finish”, “watch this PR”, or a phone/desktop notification
  request without a continuation task → **notify only**.
- “Wait for CI and continue”, “resume when checks finish”, or “when CI finishes,
  inspect/fix the failures” → **wait and react**.
- Explicit “I want to close/leave Pi” → **notify only**. Detached monitoring does
  not resume a closed session. If they also want automatic agent continuation
  after closing Pi, explain that this extension does not support that.
- Do not silently convert a notification-only request into agent continuation.

The watcher pins the PR's head commit when it starts. It does not switch to a
new commit if somebody pushes again; start a new watch for the new commit.

## Notify-only workflow: launch and leave

1. Parse the PR, repository, interval, and explicit phone preference. Run the
   mandatory preflight above and continue only on success.
2. Launch the existing watcher detached with closed stdin and redirected output.
   Use a unique log file so concurrent watches do not overwrite one another:

   ```bash
   LOG=$(mktemp /tmp/gh-pr-notify-1839.XXXXXX.log)
   nohup bash '{baseDir}/scripts/gh-pr-notify.sh' 1839 apheris/hub 15 \
     </dev/null >"$LOG" 2>&1 &
   PID=$!
   printf 'Watcher PID: %s\nLog: %s\n' "$PID" "$LOG"
   ```

   Substitute the resolved absolute script path and actual inputs. Append
   `--phone` after the interval **only** when requested.
3. A single startup check/log read is allowed if needed; do not keep polling from
   the agent. Report that monitoring is detached, show the PID and log path, and
   tell the user they can close Pi. `tail -f <log-path>` is optional for the user.
4. End the turn. The script handles waiting and notifications; no automatic agent
   reaction is scheduled.

## Wait-and-react workflow: idle and resume

1. Parse the same inputs, plus the requested continuation and optional deadline.
   Run the mandatory preflight above and continue only on success.
2. Tell the user that Pi will go idle and must remain open. They can manage the
   wait with `/wait-event status` or `/wait-event cancel`.
3. Call `wait_for_event` once, **as the only tool call in the assistant message**:

   ```json
   {
     "label": "CI for apheris/hub#1839",
     "command": "bash",
     "args": ["{baseDir}/scripts/gh-pr-notify.sh", "1839", "apheris/hub", "15"],
     "timeoutSeconds": 3600,
     "resumePrompt": "Read the watcher result for apheris/hub#1839. Report the pinned commit and whether its CI check runs passed or failed. Do not make changes unless the user requested them."
   }
   ```

   Replace `{baseDir}` with the absolute skill directory before calling the tool.
   For phone notification, append `"--phone"` to `args`. For another interval,
   replace `"15"`. Set `resumePrompt` to the user's actual requested next action.

   The script must run **in the foreground of the waiter**: do not add `nohup`,
   `&`, or a separate background launch. The extension itself manages background
   execution and terminates the agent turn. No bash/sleep or agent polling loop.
4. On wake-up, inspect the result:
   - Exit code `0`: check runs passed (success, skipped, or neutral).
   - Exit code `1`: one or more check runs failed; inspect the listed failures.
   - Exit code `3`: monitoring error (incompatible CLI, PR access/setup failure,
     invalid API response, or fetch retry limit exhausted). Report diagnostics;
     this says nothing about whether CI passed. Fix the watcher/setup before
     starting a new wait.
   - Timeout, waiter error, or another exit code: monitoring did not successfully
     complete. Do not describe it as a CI pass or automatically re-arm indefinitely.
   - Notification delivery failures are warnings, not CI status changes.
5. Continue only the authorized task. If asked to fix failures, fetch relevant
   logs and investigate. Do not automatically push, merge, or make unrelated
   changes. After a new push, explicitly arm a new wait for that commit if needed.

If `wait_for_event` is unavailable, ask the user to load the extension with
`/reload` (or offer notify-only mode). Do not simulate waiting with repeated
agent tool calls. Closing/reloading Pi cancels a wait-and-react watcher; it is
not a detached watcher and will not keep delivering notifications afterward.

## Examples

- “Notify me when https://github.com/apheris/hub/pull/1839 checks finish” →
  detached watcher for PR `1839`, repository `apheris/hub`; no agent wake-up.
- “Notify my phone when apheris/hub#1839 finishes” → detached watcher with
  `--phone`; desktop notification is retained.
- “Wait for PR 1839 on apheris/hub, then fix CI failures” → `wait_for_event`
  with the foreground watcher and a continuation instruction to inspect/fix
  failures. Keep Pi open.
- “Wait for CI on apheris/hub#1839 and just report the result; check every
  30 seconds” → wait-and-react, interval `"30"`, report-only continuation.

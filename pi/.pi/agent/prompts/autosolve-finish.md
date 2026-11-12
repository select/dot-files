---
description: Finalize solving a jira issue with a visible Herdr review and draft PR
---

Use the commands below directly; do not load the Herdr skill or reread Pi docs. Follow other required skills. Consult targeted help only on command failure.

## 1. Adversarial review

### Setup and authentication

Require `test "${HERDR_ENV:-}" = 1`; otherwise stop and ask the user to reopen inside Herdr. From the target repository:

```bash
WORK=$(mktemp -d "${TMPDIR:-/tmp}/autosolve-review.XXXXXXXX")
RUN_ID="${WORK##*.}"
herdr tab create --workspace "$HERDR_WORKSPACE_ID" \
  --cwd "$PWD" --label "autosolve-auth-$RUN_ID" --no-focus
```

Persist `WORK`, `RUN_ID`, and every returned `.result.tab.tab_id` and `.result.root_pane.pane_id` for this run's monitoring/cleanup. Always target returned IDs, never labels or UI focus. Show `herdr tab focus <tab-id>` so the user can watch. Keep tabs open until cleanup; do not reuse or touch unrelated terminals.

Run these in the auth pane via `herdr pane run <pane-id> <safely-quoted-bash-script-command>`, stopping on failure:

```bash
aws-vault login test-sso
aws-vault exec test-sso -- pi --no-extensions --no-mcp --list-models opus-5-5
aws-vault exec test-sso -- pi \
  --provider amazon-bedrock --model eu.anthropic.claude-opus-5-5 \
  --no-extensions --no-mcp --no-skills --no-prompt-templates \
  --no-context-files --no-session --no-tools --print \
  'Availability check only. Reply exactly MODEL_AVAILABLE.'
```

Use a script in `WORK` with `set -euo pipefail`, visible saved output, and an EXIT trap writing its status to a unique absolute file. Call `wait_for_event` alone in FILE mode, then inspect status/output. Require the exact model in the listing and a successful probe returning `MODEL_AVAILABLE`. On auth/model failure, stop and ask; never substitute models or expose credentials. Every Pi invocation must use `aws-vault exec test-sso --`.

### Review (maximum 3 rounds)

Write `WORK/review-prompt-N.md`: issue requirements, base branch, relevant files, verification results, and the parent-generated diff covering committed/staged/unstaged changes and relevant untracked contents. Exclude unrelated user changes. The read-only reviewer cannot run `git diff`.

Request code inspection, a **1–10 score**, blockers with file/line references, and **APPROVED/NOT APPROVED**. The reviewer only inspects; the parent fixes/tests.

Create a fresh tab per round using the setup command with label `autosolve-review-N-$RUN_ID` (substitute the round number and run suffix). In its returned shell pane, use `herdr pane run` to launch:

```bash
aws-vault exec test-sso -- pi \
  --provider amazon-bedrock --model eu.anthropic.claude-opus-5-5 \
  --no-extensions --extension builtin:codemode \
  --no-mcp --no-skills --no-prompt-templates \
  --session /absolute/path/to/WORK/reviewer-N.jsonl \
  --tools read,grep,find,ls,codemode
```

Codemode is allowed for batching/filtering `read`, `grep`, `find`, and `ls` calls only; no shell, writes, additional model calls, or uploads. The explicit `--extension builtin:codemode` keeps it loaded despite `--no-extensions`.

Substitute safely quoted real paths. Keep repository context enabled. Pi stays interactive for visibility/follow-ups, but the parent submits the review automatically.

Confirm startup with `herdr agent get <pane-id>` and `herdr pane read <pane-id> --source recent-unwrapped --lines 120`. If recognized but not ready, use `wait_for_event` in COMMAND mode for `herdr agent wait <pane-id> --until idle --timeout 120000`. Stop on unconfirmed startup or approval dialogs; do not blindly relaunch.

Once idle/ready, call `wait_for_event` alone in COMMAND mode (`command: "herdr"`, literal arguments below, `timeoutSeconds: 3660`) to submit **and** wait:

```bash
herdr agent prompt <pane-id> \
  "Read /absolute/path/to/WORK/review-prompt-N.md and perform that review." \
  --wait --timeout 3600000
```

Do not submit separately or poll. On wake-up, read `herdr agent read <pane-id> --source recent-unwrapped --lines 200` and save the complete review as `WORK/review-N.md`. If truncated, increase the line limit or recover the final assistant response from `WORK/reviewer-N.jsonl`. A settled state is not approval: verify the actual review covers this round's diff. On timeout/stalled/blocked, inspect get/read before acting; never blindly resend or answer approvals. Follow-ups use the same prompt-and-wait pattern.

Require **APPROVED, at least 8/10, and no unresolved blockers**. Otherwise fix and repeat with an updated diff and fresh reviewer, at most 3 rounds (probe excluded). If still unapproved, report findings and ask; do not commit/create a PR without user approval.

## 2. Validate

Run lintfix and unit tests; fix and repeat until both pass. Any code changes after review require approval of the final diff within the same 3-round limit; otherwise stop and ask.

## 3. Commit and draft PR

- Use the commit-message skill; commit only issue-related changes.
- UI fix: capture a screenshot with chrome-devtools.
- No UI changes: ask whether image/video proof is needed.
- Create a **draft** PR with `gh pr create --draft --title "<title>" --body-file /absolute/path/body.md`; when proof is needed, add `--attach /absolute/path/proof.png` (or a supported video). Use gh 2.99+ with CLI OAuth/classic PAT authentication and repository write access; no browser cookies.
- For an existing PR, `gh pr edit <number> --repo owner/repo --attach /absolute/path/proof.png` appends without replacing its description. A local Markdown reference in the supplied body is rewritten to the uploaded URL. Verify the resulting body; inspect it before retrying a failed upload to avoid duplicates.
- Report the review verdict/score and artifact directory.

## 4. Cleanup

After successful draft PR creation, close only this run's recorded tabs with `herdr tab close <tab-id>`. Skip tabs the user has repurposed or is actively using. Retain `WORK`, including saved sessions and review reports. On failure or unresolved findings, leave tabs open and report their IDs with focus/close commands for manual cleanup.

$@

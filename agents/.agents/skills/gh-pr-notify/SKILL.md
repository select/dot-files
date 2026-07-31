---
name: gh-pr-notify
description: "Monitor GitHub PR checks/actions and send a desktop notification when done, optionally also notifying a phone. Use this skill when: notify PR, watch PR checks, PR actions done, monitor CI, notify when checks pass, PR notification, notify my phone about PR checks"
---

# Purpose

Monitor a GitHub Pull Request's CI checks/actions in the background and send a desktop notification (`notify-send`) when all checks complete, reporting pass/fail status. When the user explicitly asks for a phone notification, also send the result through `phone-notify`; the desktop notification is always sent.

## Variables

- **gh CLI**: Required - GitHub CLI must be installed and authenticated
- **notify-send**: Required - Desktop notification tool (available on most Linux desktops)
- **phone-notify**: Assumed to be available - used only when the user requests a phone notification

## Instructions

When monitoring PR checks, you need:

**Required:**
- PR identifier: One of:
  - Full URL: `https://github.com/owner/repo/pull/123`
  - Short format: `owner/repo#123`
  - PR number + repo: `123` with `--repo owner/repo`

**Optional:**
- Poll interval in seconds (default: 15)
- Phone notification: enable only when the user explicitly asks to also be notified on their phone

## Workflow

> Execute the following steps in order, top to bottom:

1. **Parse PR Input**
   - Extract owner, repo, and PR number from the user's input
   - If only a number is given, ask (use the question tool) for the repo or detect from git remote

2. **Start the monitoring script in the background**
   ```bash
   bash -c 'nohup {baseDir}/scripts/gh-pr-notify.sh <pr-number> <owner/repo> [interval] [--phone] > /tmp/gh-pr-notify-<pr-number>.log 2>&1 & echo $!'
   ```
   - Omit `--phone` for normal PR monitoring.
   - Append `--phone` when the user asks for a phone notification. This adds a `phone-notify` push with a link to the PR while retaining the regular desktop notification.

3. **Verify the script started**
   - Wait a few seconds, then read the log to confirm it's polling
   ```bash
   sleep 5 && cat /tmp/gh-pr-notify-<pr-number>.log
   ```

4. **Report to the user**
   - Confirm monitoring is running in the background
   - Show current check status from the log
   - Tell them how to follow progress: `tail -f /tmp/gh-pr-notify-<pr-number>.log`

## Cookbook

- IF: User provides a full GitHub PR URL (e.g., `https://github.com/apheris/hub/pull/1839`)
- THEN: Extract `owner/repo` as `apheris/hub` and PR number as `1839`
- EXAMPLES:
  - User: "notify me when https://github.com/apheris/hub/pull/1839 checks are done"
  - Command: `bash -c 'nohup {baseDir}/scripts/gh-pr-notify.sh 1839 apheris/hub 15 > /tmp/gh-pr-notify-1839.log 2>&1 & echo $!'`

- IF: User provides short format (e.g., `apheris/hub#1839`)
- THEN: Parse directly into repo and PR number
- EXAMPLES:
  - User: "watch checks on apheris/hub#1839"
  - Command: `bash -c 'nohup {baseDir}/scripts/gh-pr-notify.sh 1839 apheris/hub 15 > /tmp/gh-pr-notify-1839.log 2>&1 & echo $!'`

- IF: User wants a custom poll interval
- THEN: Pass it as the third argument
- EXAMPLES:
  - User: "monitor PR 1839 on apheris/hub, check every 30 seconds"
  - Command: `bash -c 'nohup {baseDir}/scripts/gh-pr-notify.sh 1839 apheris/hub 30 > /tmp/gh-pr-notify-1839.log 2>&1 & echo $!'`

- IF: User explicitly asks to be notified on their phone
- THEN: Append `--phone` as the fourth argument; do not replace the desktop notification
- EXAMPLES:
  - User: "notify me on my phone when apheris/hub#1839 checks finish"
  - Command: `bash -c 'nohup {baseDir}/scripts/gh-pr-notify.sh 1839 apheris/hub 15 --phone > /tmp/gh-pr-notify-1839.log 2>&1 & echo $!'`

#!/usr/bin/env bash
# Monitor GitHub PR checks and send a desktop notification when done.
# Usage: gh-pr-notify.sh <pr-number> [repo] [poll-interval-seconds]

set -euo pipefail

PR="${1:?Usage: gh-pr-notify.sh <pr-number> [repo] [poll-interval]}"
REPO="${2:-apheris/hub}"
INTERVAL="${3:-15}"

echo "🔍 Monitoring PR #${PR} in ${REPO} (polling every ${INTERVAL}s)..."

# Get commit SHA and title
SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid)
TITLE=$(gh pr view "$PR" --repo "$REPO" --json title --jq .title)
echo "   Commit: ${SHA:0:8}"
echo "   Title:  ${TITLE}"
echo ""

while true; do
	# Use REST API for accurate real-time status (GraphQL caches aggressively)
	json=$(gh api "repos/${REPO}/commits/${SHA}/check-runs" --paginate 2>&1) || {
		echo "⚠️  Failed to fetch checks, retrying..."
		sleep "$INTERVAL"
		continue
	}

	total=$(echo "$json" | jq '[.check_runs[]] | length')
	pending=$(echo "$json" | jq '[.check_runs[] | select(.status != "completed")] | length')
	failures=$(echo "$json" | jq '[.check_runs[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out"))] | length')
	successes=$(echo "$json" | jq '[.check_runs[] | select(.status == "completed" and (.conclusion == "success" or .conclusion == "skipped"))] | length')

	timestamp=$(date +"%H:%M:%S")
	echo "[$timestamp] ✅ ${successes}  ❌ ${failures}  ⏳ ${pending}  (total: ${total})"

	if [[ "$pending" -gt 0 ]]; then
		echo "$json" | jq -r '.check_runs[] | select(.status != "completed") | "           ⏳ \(.name) (\(.status))"'
	fi

	if [[ "$pending" -eq 0 ]]; then
		if [[ "$failures" -gt 0 ]]; then
			icon="dialog-warning"
			summary="❌ PR #${PR} checks failed"
			body="${failures}/${total} checks failed — ${TITLE}"
		else
			icon="dialog-information"
			summary="✅ PR #${PR} checks passed"
			body="All ${total} checks passed — ${TITLE}"
		fi

		notify-send -u normal -i "$icon" "$summary" "$body"
		echo ""
		echo "$summary"
		echo "$body"

		if [[ "$failures" -gt 0 ]]; then
			echo ""
			echo "Failed checks:"
			echo "$json" | jq -r '.check_runs[] | select(.status == "completed" and (.conclusion == "failure" or .conclusion == "cancelled" or .conclusion == "timed_out")) | "  ✗ \(.name) (\(.conclusion))"'
		fi

		exit 0
	fi

	sleep "$INTERVAL"
done

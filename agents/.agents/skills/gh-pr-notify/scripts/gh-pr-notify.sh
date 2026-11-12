#!/usr/bin/env bash
# Monitor GitHub PR checks and send a desktop notification when done.
# Optionally send the same notification to a phone with phone-notify.
# Usage: gh-pr-notify.sh [--preflight] <pr-number> [repo] [poll-interval-seconds] [--phone]
# Foreground watcher: callers choose detached notifications or wait_for_event.
# Exit 0: passed (or preflight OK); 1: failed checks; 2: arguments; 3: monitoring error.

set -euo pipefail

PREFLIGHT=false
if [[ "${1:-}" == "--preflight" ]]; then
	PREFLIGHT=true
	shift
fi

PR="${1:?Usage: gh-pr-notify.sh [--preflight] <pr-number> [repo] [poll-interval]}"
REPO="${2:-apheris/hub}"
INTERVAL="${3:-15}"
PHONE_NOTIFY="${4:-}"

if [[ ! "$INTERVAL" =~ ^[0-9]+$ || "$INTERVAL" =~ ^0+$ ]]; then
	echo "Poll interval must be a positive integer" >&2
	exit 2
fi

if [[ -n "$PHONE_NOTIFY" && "$PHONE_NOTIFY" != "--phone" ]]; then
	echo "Unknown notification option: ${PHONE_NOTIFY}" >&2
	exit 2
fi

for dependency in gh jq; do
	if ! command -v "$dependency" >/dev/null 2>&1; then
		echo "Monitoring error: missing required command: ${dependency}" >&2
		exit 3
	fi
done

# Check the installed CLI, not an assumed minimum version. Never require --slurp.
if ! api_help=$(gh api --help 2>&1) || [[ "$api_help" != *--paginate* ]]; then
	printf 'Monitoring error: gh api must support --paginate.\n%s\n' "$api_help" >&2
	exit 3
fi

error_file=$(mktemp)
trap 'rm -f "$error_file"' EXIT

fetch_checks() {
	local attempt=0 pages error
	local limit=3
	if [[ "$PREFLIGHT" == true ]]; then limit=1; fi
	while true; do
		# Keep stderr separate from the stream of paginated JSON objects.
		if pages=$(gh api "repos/${REPO}/commits/${SHA}/check-runs" --paginate 2>"$error_file"); then
			break
		fi
		attempt=$((attempt + 1))
		error=$(<"$error_file")
		printf 'Failed to fetch checks (attempt %s/%s):\n%s\n' "$attempt" "$limit" "$error" >&2
		if [[ "$error" =~ ([Uu]nknown|[Uu]nrecognized|[Uu]nsupported)[[:space:]]+(flag|option) ||
			"$error" == *"flag provided but not defined"* ]]; then
			echo "Monitoring error: incompatible gh CLI; not retrying." >&2
			return 3
		fi
		if (( attempt >= limit )); then
			echo "Monitoring error: fetch attempt limit reached; stopping watcher." >&2
			return 3
		fi
		sleep "$INTERVAL"
	done

	# gh --paginate emits separate JSON objects; jq -s merges all pages locally.
	if ! json=$(printf '%s\n' "$pages" | jq -se '
		if length > 0 and all(.[]; (.check_runs | type) == "array")
		then {check_runs: [.[].check_runs[]]}
		else error("Expected check_runs arrays in REST pages") end'); then
		echo "Monitoring error: invalid check-runs response; not retrying." >&2
		return 3
	fi
}

echo "🔍 Monitoring PR #${PR} in ${REPO} (polling every ${INTERVAL}s)..."
if [[ "$PHONE_NOTIFY" == "--phone" ]]; then
	echo "   Phone notifications enabled"
fi

# Get commit SHA and title
if ! SHA=$(gh pr view "$PR" --repo "$REPO" --json headRefOid --jq .headRefOid) ||
	! TITLE=$(gh pr view "$PR" --repo "$REPO" --json title --jq .title); then
	echo "Monitoring error: unable to resolve PR metadata; check gh compatibility and authentication." >&2
	exit 3
fi
echo "   Commit: ${SHA:0:8}"
echo "   Title:  ${TITLE}"
echo ""

if [[ "$PREFLIGHT" == true ]]; then
	fetch_checks || exit 3
	echo "Preflight OK: gh pagination, PR access, and check-runs response verified."
	exit 0
fi

while true; do
	# Use REST API for accurate real-time status (GraphQL caches aggressively).
	# Each poll allows at most three fetch attempts; successful polls reset the budget.
	fetch_checks || exit 3
	# Never treat an empty check list as success.
	total=$(echo "$json" | jq '.check_runs | length')
	pending=$(echo "$json" | jq '[.check_runs[] | select(.status != "completed")] | length')
	failures=$(echo "$json" | jq '[.check_runs[] | select(.status == "completed" and (.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral"))] | length')
	successes=$(echo "$json" | jq '[.check_runs[] | select(.status == "completed" and (.conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral"))] | length')

	timestamp=$(date +"%H:%M:%S")
	echo "[$timestamp] ✅ ${successes}  ❌ ${failures}  ⏳ ${pending}  (total: ${total})"

	if [[ "$total" -eq 0 ]]; then
		echo "           Waiting for CI check runs to register..."
		sleep "$INTERVAL"
		continue
	fi

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

		notify-send -u normal -i "$icon" "$summary" "$body" || \
			echo "⚠️  Failed to send desktop notification" >&2
		if [[ "$PHONE_NOTIFY" == "--phone" ]]; then
			phone-notify --url "https://github.com/${REPO}/pull/${PR}" "$summary" "$body" || \
				echo "⚠️  Failed to send phone notification" >&2
		fi
		echo ""
		echo "$summary"
		echo "$body"

		if [[ "$failures" -gt 0 ]]; then
			echo ""
			echo "Failed checks:"
			echo "$json" | jq -r '.check_runs[] | select(.status == "completed" and (.conclusion != "success" and .conclusion != "skipped" and .conclusion != "neutral")) | "  ✗ \(.name) (\(.conclusion))"'
			exit 1
		fi

		exit 0
	fi

	sleep "$INTERVAL"
done

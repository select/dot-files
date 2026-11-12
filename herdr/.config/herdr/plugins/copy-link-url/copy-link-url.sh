#!/bin/sh
# Herdr link handler: copy the Ctrl+clicked URL to the clipboard.
set -eu

url="${HERDR_PLUGIN_CLICKED_URL:-}"

# Fall back to parsing the injected context JSON if the env var is absent.
if [ -z "$url" ] && [ -n "${HERDR_PLUGIN_CONTEXT_JSON:-}" ]; then
	url=$(printf '%s' "$HERDR_PLUGIN_CONTEXT_JSON" |
		sed -n 's/.*"clicked_url":"\([^"]*\)".*/\1/p')
fi

[ -n "$url" ] || exit 0

if command -v wl-copy >/dev/null 2>&1; then
	printf '%s' "$url" | wl-copy
elif command -v xclip >/dev/null 2>&1; then
	printf '%s' "$url" | xclip -selection clipboard
elif command -v xsel >/dev/null 2>&1; then
	printf '%s' "$url" | xsel --clipboard --input
fi

herdr="${HERDR_BIN_PATH:-herdr}"
"$herdr" notification show "Copied URL" --body "$url" --sound none >/dev/null 2>&1 || true

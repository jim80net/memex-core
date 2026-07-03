#!/usr/bin/env bash
# Phase-1b spike: capture UserPromptSubmit stdin AND inject additionalContext marker.
set -euo pipefail

# shellcheck source=capture-common.sh
source "$(dirname "$0")/capture-common.sh"
capture_hook_stdin

readonly MARKER='memex-spike: injection marker 7f3a'

if command -v jq >/dev/null 2>&1; then
  jq -n --arg ctx "${MARKER}" '{additionalContext: $ctx}'
else
  # Minimal JSON escape for the fixed marker (no quotes in marker string).
  printf '{"additionalContext":"%s"}\n' "${MARKER}"
fi

printf 'memex-spike[phase-1b]: injected additionalContext marker\n' >&2
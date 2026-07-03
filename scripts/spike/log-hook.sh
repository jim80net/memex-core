#!/usr/bin/env bash
# Phase-1 spike: capture hook stdin; no-op HookOutput.
set -euo pipefail

# shellcheck source=capture-common.sh
source "$(dirname "$0")/capture-common.sh"
capture_hook_stdin

printf '{}\n'
#!/usr/bin/env bash
# Phase 1c: plugin-bundled hooks only (no user/project hook layers).
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CAPTURE_ROOT="${CODEX_HOME:-${HOME}/.codex}/spike-captures/phase-1c"
MEMEX_CODEX="${MEMEX_CODEX_ROOT:-/home/jim/workspace/github.com/jim80net/memex-codex}"

mkdir -p "${CAPTURE_ROOT}"

# Ensure local marketplace + plugin installed
if ! codex plugin list 2>/dev/null | grep -q 'memex-codex@memex-codex-local.*installed'; then
  if [ ! -f "${MEMEX_CODEX}/.agents/plugins/marketplace.json" ]; then
    echo "phase-1c: missing ${MEMEX_CODEX}/.agents/plugins/marketplace.json" >&2
    exit 1
  fi
  if [ ! -e "${MEMEX_CODEX}/plugins/memex-codex" ]; then
    ln -sfn .. "${MEMEX_CODEX}/plugins/memex-codex"
  fi
  codex plugin marketplace add "${MEMEX_CODEX}" 2>/dev/null || true
  codex plugin add memex-codex@memex-codex-local
fi

# Disable user/project hook layers for isolated plugin proof
if [ -f "${HOME}/.codex/hooks.json" ]; then
  mv "${HOME}/.codex/hooks.json" "${HOME}/.codex/hooks.json.disabled-phase1c"
fi
if [ -f "${REPO_ROOT}/.codex/hooks.json" ]; then
  mv "${REPO_ROOT}/.codex/hooks.json" "${REPO_ROOT}/.codex/hooks.json.disabled-phase1c"
fi

TS="$(date -u +%Y%m%dT%H%M%SZ)"
LOG="${CAPTURE_ROOT}/exec-${TS}.log"

cd "${REPO_ROOT}"
codex exec \
  --dangerously-bypass-hook-trust \
  --dangerously-bypass-approvals-and-sandbox \
  -s danger-full-access \
  -c 'sandbox_permissions=["disk-full-read-access"]' \
  "Phase 1c plugin hook probe. Reply with exactly: phase-1c-probe" \
  2>&1 | tee "${LOG}"

echo "phase-1c: log -> ${LOG}" >&2
rg 'hook: (SessionStart|UserPromptSubmit|Stop)' "${LOG}" || true
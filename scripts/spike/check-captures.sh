#!/usr/bin/env bash
# Summarize Phase-1 spike captures and flag transcript_path on Stop events.
set -euo pipefail

CAPTURE_ROOT="${CODEX_HOME:-${HOME}/.codex}/spike-captures/phase-1"

if [[ ! -d "${CAPTURE_ROOT}" ]]; then
  printf 'No captures at %s\n' "${CAPTURE_ROOT}" >&2
  exit 1
fi

shopt -s nullglob
files=("${CAPTURE_ROOT}"/*.json)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  printf 'No .json captures in %s\n' "${CAPTURE_ROOT}" >&2
  exit 1
fi

printf '=== Phase-1 captures (%d files) ===\n' "${#files[@]}"

declare -A events=()
stop_has_transcript=0

for f in "${files[@]}"; do
  [[ "${f}" == *.meta ]] && continue
  base="$(basename "${f}")"
  if command -v jq >/dev/null 2>&1; then
    event="$(jq -r '.hook_event_name // "unknown"' "${f}" 2>/dev/null || echo parse-error)"
    keys="$(jq -r 'keys | join(", ")' "${f}" 2>/dev/null || echo '?')"
    events["${event}"]=$(( ${events["${event}"]:-0} + 1 ))
    if [[ "${event}" == "Stop" ]] && jq -e '.transcript_path' "${f}" >/dev/null 2>&1; then
      stop_has_transcript=1
      printf 'WARN Stop capture has transcript_path: %s\n' "${base}"
    fi
    printf '%s  event=%s  keys=[%s]\n' "${base}" "${event}" "${keys}"
  else
    printf '%s  (install jq for field summary)\n' "${base}"
  fi
done

printf '\n=== Event counts ===\n'
for e in "${!events[@]}"; do
  printf '  %s: %d\n' "${e}" "${events[$e]}"
done

if [[ ${stop_has_transcript} -eq 0 ]]; then
  printf '\nStop events: no transcript_path observed (matches design assumption).\n'
fi

printf '\nLatest capture:\n'
latest="$(ls -t "${CAPTURE_ROOT}"/*.json 2>/dev/null | head -1)"
if [[ -n "${latest}" ]] && command -v jq >/dev/null 2>&1; then
  jq . "${latest}"
fi
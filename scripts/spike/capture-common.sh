# shellcheck shell=bash
# Shared Phase-1 spike capture — source from hook scripts; do not execute directly.
capture_hook_stdin() {
  CAPTURE_ROOT="${CODEX_HOME:-${HOME}/.codex}/spike-captures/phase-1"
  REPO_TAG="${REPO_TAG:-codex-memex-dev}"

  mkdir -p "${CAPTURE_ROOT}"

  CAPTURE_INPUT="$(cat)"
  CAPTURE_TS="$(date -u +%Y%m%dT%H%M%SZ)"

  CAPTURE_EVENT="unknown"
  if command -v jq >/dev/null 2>&1; then
    CAPTURE_EVENT="$(
      printf '%s' "${CAPTURE_INPUT}" | jq -r '.hook_event_name // .event // "unknown"' 2>/dev/null || echo unknown
    )"
  fi

  local slug="${CAPTURE_EVENT//[^a-zA-Z0-9._-]/_}"
  CAPTURE_FILE="${CAPTURE_ROOT}/${CAPTURE_TS}-${slug}-${$}.json"

  printf '%s\n' "${CAPTURE_INPUT}" >"${CAPTURE_FILE}"

  {
    printf 'captured_at=%s\n' "${CAPTURE_TS}"
    printf 'pid=%s\n' "$$"
    printf 'repo_tag=%s\n' "${REPO_TAG}"
    printf 'cwd=%s\n' "$(pwd)"
    printf 'bytes=%s\n' "$(printf '%s' "${CAPTURE_INPUT}" | wc -c | tr -d ' ')"
  } >"${CAPTURE_FILE%.json}.meta"

  printf 'memex-spike[phase-1]: captured %s (%s bytes) -> %s\n' \
    "${CAPTURE_EVENT}" "$(wc -c <"${CAPTURE_FILE}" | tr -d ' ')" "${CAPTURE_FILE}" >&2
}
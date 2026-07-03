# Phase-1 spike — in progress

**Gate:** COS approved v1.2 (2026-07-02). Auth still required for live Codex session.
**Blocked on:** `codex login` (operator)

## Staged artifacts

| File | Purpose |
|------|---------|
| `.codex/hooks.json` | Project hooks (dev spike; plugin-bundled proof is Phase 1c post-scaffold) |
| `scripts/spike/capture-common.sh` | Shared stdin capture |
| `scripts/spike/log-hook.sh` | Capture only → `{}` (SessionStart, PreToolUse, Stop) |
| `scripts/spike/inject-user-prompt.sh` | Capture + `additionalContext` marker (UserPromptSubmit) |
| `scripts/spike/check-captures.sh` | Post-run summary + `transcript_path` check on Stop |

Captures: `~/.codex/spike-captures/phase-1/`

Injection marker: `memex-spike: injection marker 7f3a`

## Operator runbook (post-login)

```bash
cd /home/jim/workspace/github.com/jim80net/codex-memex-dev
codex login
codex
```

1. Trust project hooks via `/hooks` when prompted.
2. Submit any prompt containing e.g. `what marker did memex inject?`
3. End the turn (Stop hook fires).
4. Exit Codex.

## Verify locally

```bash
bash scripts/spike/check-captures.sh
```

**Phase 1a success:** captures for SessionStart, UserPromptSubmit, PreToolUse, Stop; stdin field names recorded.

**Phase 1b success:** model reply references `7f3a` or quotes the injection marker in the same turn. Harness `codexstore.ReplyAfter` (PR #259) is independent corroboration — not the primary gate.

**Stop assumption:** `check-captures.sh` reports no `transcript_path` on Stop events.

## Record results

Append to this file after live run:

- Per-event stdin key list (from `check-captures.sh` / `jq`)
- Injection proof: yes/no + model excerpt
- `transcript_path` on Stop: present/absent
- Any Codex-only fields → update `memex-codex-adapter-design.md` before Phase 2

## Phase 1c (after memex-codex plugin scaffold)

```bash
rm .codex/hooks.json   # isolate plugin path
codex plugin marketplace add <local>
codex plugin add memex-codex
codex plugin list
codex
```

Repeat injection proof with plugin-bundled hooks only.

## Teardown

**After Phase 1c** (plugin-bundled hooks proven via `codex plugin add`): remove or disable the dev spike project hooks so only the plugin path runs — the committed `.codex/hooks.json` in this worktree is dev convenience, not the ship path.

```bash
rm .codex/hooks.json
# or: mv .codex/hooks.json .codex/hooks.json.disabled
```
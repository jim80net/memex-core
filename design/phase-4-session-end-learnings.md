# Phase 4 — session-end learnings (2026-07-03)

**Gate:** COS authorized after Phase 2 merge (#6). **Status:** implemented in memex-codex (mechanical capture); LLM extraction deferred to Phase 5 skills.

## Problem

Codex stores the canonical turn log in rollout JSONL (`~/.codex/sessions/…/rollout-*.jsonl`). Stop hook stdin carries `transcript_path`, `last_assistant_message`, and `session_id` (Phase 1a PASS). Hermes runs inline LLM extraction on session-end; memex-claude defers to `/reflect` + `/deep-sleep` skills. memex-codex **Option A** follows the claude pattern — hooks must stay fast and must not require API keys.

## Resolution order (assistant text for behavioral rules)

| Priority | Source | When |
|----------|--------|------|
| 1 | `last_assistant_message` (Stop stdin) | Always when non-empty — avoids rollout read on hot path |
| 2 | `transcript_path` → `readLastAgentText` | When payload omits message but path present |
| 3 | `codexstore.latestResult(CODEX_HOME, cwd)` | Fallback when path absent |

Implemented in `src/hooks/stop.ts` + `src/core/codex-hook-input.ts`.

## extractLearnings — mechanical capture (v1)

When `hooks.Stop.extractLearnings: true` (default in config template; Stop hook itself defaults `enabled: false`):

1. Resolve rollout path via **`resolveTranscriptPath(codexHome, cwd, transcript_path)`** — returns `transcript_path` when present, else delegates to `resolveRolloutPath(codexHome, cwd)` (codexstore cwd lookup)
2. `listUserMessages(rollout)` — event_msg `user_message` lines, min 10 chars (deep-sleep parity)
3. Enqueue `PendingLearningSession` in `~/.codex/cache/memex-learnings-queue.json` via `enqueuePendingSession` (see concurrent-write safety below)

**No LLM in the Stop hook.** Queue is consumed by Phase 5 bundled `reflect` / `deep-sleep` skills (agent reads queue + rollout, writes `session-learning` entries per Option A).

## Queue concurrent-write safety (shipped in #7)

`enqueuePendingSession` (`src/core/learnings-queue.ts`) serializes all queue mutations:

| Mechanism | Behavior |
|-----------|----------|
| **`withFileLock(path)`** | memex-core file lock on `memex-learnings-queue.json` — concurrent Stop hooks block, not interleave |
| **Read-modify-write** | Load queue → validate `version: 1` → filter malformed entries |
| **Dedup** | Skip enqueue when `session_id` already present (repeat Stop on same session is a no-op) |
| **Cap** | `MAX_QUEUE = 50` — newest-first (`unshift`); trim tail after insert |
| **Atomic persist** | Write `path.<random>.tmp` then `rename(tmp, path)` — readers never see partial JSON |

Phase 5 skill consumers should use the same lock when dequeuing or mutating the queue.

## Queue record shape

```json
{
  "version": 1,
  "sessions": [
    {
      "session_id": "019f…",
      "cwd": "/path/to/worktree",
      "transcript_path": "/home/jim/.codex/sessions/…/rollout-….jsonl",
      "captured_at": "2026-07-03T06:00:00.000Z",
      "user_message_count": 12
    }
  ]
}
```

## codexstore extensions (mirrors flotilla `internal/codexstore`)

| API | Purpose |
|-----|---------|
| `resolveTranscriptPath` | Stop path resolution — `transcript_path` if set, else `resolveRolloutPath` |
| `resolveRolloutPath` | Cwd → newest matching rollout JSONL (existing) |
| `listUserMessages` | Learnings input scan |
| `latestResult` / `readLastAgentText` | Existing — behavioral rules + spike harness |

No second rollout parser — TypeScript port stays aligned with codex-harness-dev PR #259.

## SQLite fallback (`logs_2.sqlite`) — deferred

Design reserve: when rollout JSONL is missing or corrupt, Phase 5+ may read `logs_2.sqlite` under the session dir. Not implemented in Phase 4 spike — rollout + Stop payload cover live `codex exec` and interactive paths confirmed in Phase 1.

## Future opt-in: Hermes-style inline extraction

If operator enables `hooks.Stop.extractionModel` + API key env in a later phase, a guarded code path may call chat-completions from the Stop hook (30s timeout). Out of scope for Phase 4 — queue + skills is the default v1 posture.

## Verification

- vitest: `codexstore` user messages, `learnings-queue`, `extract-learnings`, Stop `last_assistant_message` fast path
- Live (optional): enable Stop + extractLearnings in `~/.codex/memex.json`, complete a turn, inspect `memex-learnings-queue.json`

## Next: Phase 5

Bundle `reflect`, `deep-sleep`, `memory-creation`, `help`, `doctor`, `handoff` skills; deep-sleep drains `memex-learnings-queue.json` and writes `session-learning` markdown under `~/.codex/memex/projects/<encoded>/memory/`.
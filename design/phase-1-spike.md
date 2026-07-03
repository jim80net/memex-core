# Phase-1 spike — live results (2026-07-03)

**Gate:** COS approved v1.2. Auth verified (`codex login` → ChatGPT). Live `codex exec` sessions run from `codex-memex-dev` @ main (PR #25 harness).

## Run configuration

- Codex CLI **0.142.5**, model **gpt-5.5**, `originator: codex_exec`
- Hooks: user-level `~/.codex/hooks.json` (absolute paths into this worktree) + `--dangerously-bypass-hook-trust` for automation
- Project trust: `[projects."/home/jim/.../codex-memex-dev"] trust_level = "trusted"` added to `~/.codex/config.toml`
- **Note:** project-only `.codex/hooks.json` did **not** fire without user-level hooks in `codex exec` (even with project trust + bypass). Interactive `/hooks` trust not exercised this pass.

Captures: `~/.codex/spike-captures/phase-1/` (archived prior pipe-smoke under `phase-1-prior/`)

## Phase 1a — hook stdin fields (PASS)

Live captures from session `019f25aa-985b-7510-99a7-157901d23b14` (tool-using turn):

| Event | stdin keys (live) |
|-------|-------------------|
| **SessionStart** | `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `source` |
| **UserPromptSubmit** | `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `prompt` |
| **PreToolUse** | `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `tool_name`, `tool_input`, `tool_use_id` |
| **Stop** | `session_id`, `turn_id`, `transcript_path`, `cwd`, `hook_event_name`, `model`, `permission_mode`, `stop_hook_active`, `last_assistant_message` |

**PreToolUse** only fires when the model invokes a tool (observed on `Bash` / `exec_command`).

### Verbatim captures (representative)

**SessionStart:**
```json
{"session_id":"019f25aa-985b-7510-99a7-157901d23b14","transcript_path":"/home/jim/.codex/sessions/2026/07/03/rollout-2026-07-03T01-49-24-019f25aa-985b-7510-99a7-157901d23b14.jsonl","cwd":"/home/jim/workspace/github.com/jim80net/codex-memex-dev","hook_event_name":"SessionStart","model":"gpt-5.5","permission_mode":"bypassPermissions","source":"startup"}
```

**UserPromptSubmit:**
```json
{"session_id":"019f25aa-985b-7510-99a7-157901d23b14","turn_id":"019f25aa-9906-7a70-91e5-8bcf6898981e","transcript_path":"/home/jim/.codex/sessions/2026/07/03/rollout-2026-07-03T01-49-24-019f25aa-985b-7510-99a7-157901d23b14.jsonl","cwd":"/home/jim/workspace/github.com/jim80net/codex-memex-dev","hook_event_name":"UserPromptSubmit","model":"gpt-5.5","permission_mode":"bypassPermissions","prompt":"what marker did memex inject? Reply with only the marker string."}
```

**PreToolUse:**
```json
{"session_id":"019f25aa-985b-7510-99a7-157901d23b14","turn_id":"019f25aa-9906-7a70-91e5-8bcf6898981e","transcript_path":"/home/jim/.codex/sessions/2026/07/03/rollout-2026-07-03T01-49-24-019f25aa-985b-7510-99a7-157901d23b14.jsonl","cwd":"/home/jim/workspace/github.com/jim80net/codex-memex-dev","hook_event_name":"PreToolUse","model":"gpt-5.5","permission_mode":"bypassPermissions","tool_name":"Bash","tool_input":{"command":"rg -n \"memex|marker|inject\" ."},"tool_use_id":"call_ChEoDShVTstHoIJphP7hbpSu"}
```

**Stop (success turn):**
```json
{"session_id":"019f25aa-985b-7510-99a7-157901d23b14","turn_id":"019f25aa-9906-7a70-91e5-8bcf6898981e","transcript_path":"/home/jim/.codex/sessions/2026/07/03/rollout-2026-07-03T01-49-24-019f25aa-985b-7510-99a7-157901d23b14.jsonl","cwd":"/home/jim/workspace/github.com/jim80net/codex-memex-dev","hook_event_name":"Stop","model":"gpt-5.5","permission_mode":"bypassPermissions","stop_hook_active":false,"last_assistant_message":"memex-spike: injection marker 7f3a"}
```

## Phase 1b — injection proof

### Initial negative (methodology sound — false positives rejected)

First live pass used **bare** top-level `{"additionalContext":"..."}` (Claude-shaped stdout). Codex 0.142.5 reported **`UserPromptSubmit Failed`** on every turn; rollout lacked injected text; neutral prompts usually returned `<!-- gitnexus:start -->` (first line of loaded `AGENTS.md`).

| Probe | Result |
|-------|--------|
| Hook stdout wire (v1) | `{"additionalContext":"memex-spike: injection marker 7f3a"}` — **invalid** for Codex |
| Codex hook status | **`UserPromptSubmit Failed`** |
| Rollout prompt visibility | No `7f3a` before model acts |
| Rejected false positive | Model once returned `7f3a` after **`rg` repo search** hit `inject-user-prompt.sh`, and once after a **leaky prompt** (`contains 7f3a`) — neither counts as hook injection |

**Root cause (COS + binary schema verified):** `UserPromptSubmitHookSpecificOutputWire` requires the **`hookSpecificOutput` wrapper** (`additionalProperties: false` on top-level `HookOutput`). Bare `additionalContext` fails schema validation → hook Failed. **Not** a platform denial of injection.

### Corrected wire + re-run (PASS)

**Required stdout shape (UserPromptSubmit):**

```json
{
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "memex-spike: injection marker 7f3a"
  }
}
```

Every Codex hook event has its own `*HookSpecificOutputWire` with the same nesting pattern.

**Passing session:** `019f25b4-c0fe-7712-8c5a-1c54674556a3` (2026-07-03, user-level hooks only + `--dangerously-bypass-hook-trust`).

| Probe | Result |
|-------|--------|
| Codex stderr | `hook: UserPromptSubmit` → **`Completed`** |
| Model reply | `memex-spike: injection marker 7f3a` |
| Rollout | `role: developer` / `input_text`: `memex-spike: injection marker 7f3a` — **zero tool calls** |
| Neutral prompt | `what marker did memex inject? Reply with the exact marker string only, nothing else.` |

**Stop capture (passing turn):**
```json
{"session_id":"019f25b4-c0fe-7712-8c5a-1c54674556a3","turn_id":"019f25b4-c180-7453-978f-225eee29e340","transcript_path":"/home/jim/.codex/sessions/2026/07/03/rollout-2026-07-03T02-00-30-019f25b4-c0fe-7712-8c5a-1c54674556a3.jsonl","cwd":"/home/jim/workspace/github.com/jim80net/codex-memex-dev","hook_event_name":"Stop","model":"gpt-5.5","permission_mode":"bypassPermissions","stop_hook_active":false,"last_assistant_message":"memex-spike: injection marker 7f3a"}
```

**Verdict:** Phase 1b **PASS** with wrapped wire. Hook-based context injection on Codex 0.142.5 is **confirmed** — semantics Claude-isomorphic (`additionalContext` string inside event-specific `hookSpecificOutput`).

## Design assumptions — empirical status

| Assumption | Design expectation | Live finding |
|------------|-------------------|--------------|
| **Stop `transcript_path` absent** | Absent; use rollout JSONL via `codexstore` | **FALSIFIED** — present on **SessionStart, UserPromptSubmit, PreToolUse, Stop**; points at `~/.codex/sessions/.../rollout-*.jsonl` |
| **AGENTS.md 32 KiB cap** | Documented default, unverified | `AGENTS.md` in this worktree = **4318 bytes** (loaded in full; cap not exercised) |
| **`additionalContext` in model turn** | UserPromptSubmit injects visible context | **CONFIRMED** with `hookSpecificOutput` wrapper; bare top-level wire fails schema |
| **Stop extra fields** | (not previously listed) | **`last_assistant_message`**, **`stop_hook_active`** (false in exec mode) |

## Required design updates (before Phase 2 adapter logic)

1. **§4.5 / §9:** `transcript_path` is **present** on Stop (and other events) — path is the rollout JSONL file. Phase 4 may use Stop stdin `transcript_path` **or** `codexstore` (both valid; prefer documenting dual path).
2. **§4.2:** `project_doc_max_bytes` default **32 KiB** — AGENTS.md here is 4.2 KiB; cap not hit (still not a measured config default on host).
3. **§4.1 / hook wire:** Codex requires per-event `hookSpecificOutput` wrapper (`hookEventName` + event fields, `additionalProperties: false`). UserPromptSubmit: `{"hookSpecificOutput":{"hookEventName":"UserPromptSubmit","additionalContext":"<string>"}}`. Bare top-level `additionalContext` fails validation. memex-on-codex **stays on hook-based injection** — no pivot.
4. **Phase 1c:** In progress — plugin install path validated; hook runtime fix landed in memex-codex `bin/memex` (see below).

## Phase 1c — plugin-bundled hooks (in progress, 2026-07-03)

**Setup (verified):**
- Local marketplace: `memex-codex/.agents/plugins/marketplace.json` + `plugins/memex-codex` → repo root
- `codex plugin marketplace add <memex-codex-repo>`
- `codex plugin add memex-codex@memex-codex-local` → cache `~/.codex/plugins/cache/memex-codex-local/memex-codex/0.1.0`
- User + project hook layers disabled (`hooks.json` → `*.disabled-phase1c`)

**First live exec (FAIL — root-caused):**

| Probe | Result |
|-------|--------|
| Plugin hooks invoked | **Yes** — `hook: SessionStart`, `UserPromptSubmit`, `Stop` lines present |
| Hook status | **Failed** on all three events |
| Direct `bin/memex` in cache | `Cannot find module .../node_modules/tsx/dist/cli.mjs` — plugin snapshot had no `node_modules` |

**Root cause:** Codex plugin install copies source but does not run `pnpm install`. `bin/memex` tsx fallback requires `node_modules/.bin/tsx`.

**Fix (memex-codex `bin/memex`):** auto-run `pnpm install --frozen-lockfile` when tsx missing (≈450ms on host). Re-test pending after plugin reinstall + `scripts/spike/run-phase-1c.sh`.

**Interactive `/hooks` trust:** not exercised this pass (automation used `--dangerously-bypass-hook-trust`).

## Operator / automation notes

- `codex exec` automation used **user-level** `~/.codex/hooks.json` only (project `.codex/hooks.json` disabled for pass run) — **one hook source**, no concurrent handlers.
- Project `.codex/hooks.json` alone did not fire in `codex exec` without user-level hooks in this environment (trust + bypass insufficient); Phase 1c will validate plugin-bundled path.

## Teardown (unchanged)

After Phase 1c: remove dev `.codex/hooks.json` from worktree; remove temporary `~/.codex/hooks.json` used for exec automation.
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

## Phase 1b — injection proof (FAIL / inconclusive)

| Probe | Result |
|-------|--------|
| Hook stdout wire | `{"additionalContext":"memex-spike: injection marker 7f3a"}` (string scalar) |
| Codex hook status | **`UserPromptSubmit Failed`** on every live turn with `inject-user-prompt.sh` (despite valid JSON on pipe) |
| Rollout prompt visibility | **No `7f3a` / `memex-spike` in rollout JSONL prompt items** before model acts |
| Neutral prompt replies | Usually `<!-- gitnexus:start -->` (first line of loaded `AGENTS.md`) |
| Apparent success once | Model returned `memex-spike: injection marker 7f3a` after **`rg` repo search** found `scripts/spike/inject-user-prompt.sh` — **not** hook `additionalContext` |

**Verdict:** `additionalContext` injection is **not confirmed model-visible** on this host. Phase 1b gate **not met**. Adapter must not assume Claude-isomorphic string `additionalContext` works on Codex 0.142.5 without further wire debugging (array vs string, hook failure root cause, interactive `/hooks` trust path).

## Design assumptions — empirical status

| Assumption | Design expectation | Live finding |
|------------|-------------------|--------------|
| **Stop `transcript_path` absent** | Absent; use rollout JSONL via `codexstore` | **FALSIFIED** — present on **SessionStart, UserPromptSubmit, PreToolUse, Stop**; points at `~/.codex/sessions/.../rollout-*.jsonl` |
| **AGENTS.md 32 KiB cap** | Documented default, unverified | `AGENTS.md` in this worktree = **4318 bytes** (loaded in full; cap not exercised) |
| **`additionalContext` in model turn** | UserPromptSubmit injects visible context | **Not demonstrated** (hook reports Failed; rollout lacks injected text) |
| **Stop extra fields** | (not previously listed) | **`last_assistant_message`**, **`stop_hook_active`** (false in exec mode) |

## Required design updates (before Phase 2 adapter logic)

1. **§4.5 / §9:** `transcript_path` is **present** on Stop (and other events) — path is the rollout JSONL file. Phase 4 may use Stop stdin `transcript_path` **or** `codexstore` (both valid; prefer documenting dual path).
2. **§4.2:** `project_doc_max_bytes` default **32 KiB** — AGENTS.md here is 4.2 KiB; cap not hit (still not a measured config default on host).
3. **§4.1 / hook wire:** Document `UserPromptSubmit` hook **Failed** status with current string `additionalContext` output; spike did not confirm `AdditionalContextEntry` array wire.
4. **Phase 1c:** Still pending plugin-bundled hooks + interactive `/hooks` trust (not exercised).

## Operator / automation notes

- `codex exec` automation required **user-level** `~/.codex/hooks.json` in this environment.
- Duplicate project + user hook layers caused concurrent UserPromptSubmit handlers in some runs — use **one** hook source per spike.

## Teardown (unchanged)

After Phase 1c: remove dev `.codex/hooks.json` from worktree; remove temporary `~/.codex/hooks.json` used for exec automation.
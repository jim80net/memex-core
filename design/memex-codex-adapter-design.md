# memex-codex — Adapter Design

**Status:** **APPROVED v1.2** (COS final gate 2026-07-02) — Phase 0 complete; **Phase 1 in progress**
**Date:** 2026-07-02
**Author:** codex-memex-dev desk
**Related:** `@jim80net/memex-core`, `memex-claude`, `memex-openclaw`, `memex-hermes`, `codex-harness-dev`
**Ground truth:** codex-cli **0.142.5** — hook surface **verified in binary** (see §4.8); session store **codex-harness-dev PR #259** (see §4.5, §8)

### Gate revision log (1a + 1b)

| ID | Finding | Resolution | § |
|----|---------|------------|---|
| 1a-P2-1 | `projectsDir` undefined vs `getProjectMemoryDir` | **Fixed** — `projectsDir = $CODEX_HOME/memex/projects/` (memex-owned namespace) | §6.1, §6.3 |
| 1a-P2-2 | Silent drops of sleep/cron/skills | **Fixed** — explicit §2.1 disposition table | §2.1 |
| 1a-P3a | `globalRulesDir` required | **Fixed** — placeholder documented | §6.1 |
| 1a-P3b | `takeover` name collision | **Fixed** — §6.4 uses defer/authoritative | §6.4 |
| 1a-P3c | Tier-2 pin policy ambiguous | **Fixed** — range vs resolved split | §5.3 |
| 1a-P3d | Stop default unstated | **Fixed** — `hooks.Stop.enabled: false` v1 | §6.2 |
| 1b-P1 | Memory write path unspecified | **Fixed** — **Option A** chosen; Tier 3 removed; write path §5.6 | §5.3, §5.6 |
| 1b-P2-1 | `transcript_path` unlikely on Stop | **Fixed** — absent by design; Phase 4 uses rollout JSONL (`codexstore`) | §4.5, §6.2, §9 |
| 1b-P2-2 | `projectsDir` ambiguity | **Fixed** — same as 1a-P2-1; `~/.codex/memex/projects/` | §6.1 |
| 1b-P2-3 | Conformance template split | **Fixed** — claude vs hermes roles; §5.4 vendoring required; §5.5 blocking | §3, §5 |
| 1b-P3a | Trust bypass spelling | **Fixed** — CLI flag + config key both documented | §4.1 |
| 1b-P3b | `plugin_hooks` removed flag | **Fixed** — graduated feature; Phase 1 tests plugin-bundled hooks | §4.6, §9 |
| 1b-P3c | Phase 1 must verify injection | **Fixed** — UserPromptSubmit + `additionalContext` in model | §9 |
| 1b-P3d | AGENTS.md 32 KiB unverified | **Fixed** — softened to documented default | §4.2 |
| xdesk | Session store dual layout | **Updated** — rollout JSONL canonical turn log + SQLite index; reuse flotilla `codexstore` (PR #259) | §4.5, §8 |
| trio | §4.7 rules scope overstated | **Fixed** — defense-in-depth backstop only; not wholesale merge/push forbid (PR #259 fix round) | §4.7 |
| trio | `${PLUGIN_ROOT}` undocumented | **Fixed** — documented in §4.1 plugin hook commands | §4.1 |
| memex | §5.5 golden-fixture contract | **Confirmed** — freeze `memex-hermes` `main` @ `edf1bf6`; Phase 3 unblocked | §5.2–§5.5, §9 |

## 1. Goal

Build a memex adapter for **OpenAI Codex CLI** (GPT-5.5-codex) so Codex sessions get the same semantic skill/memory/rule injection and git-synced cross-harness corpus that Claude Code, Grok, OpenClaw, and Hermes sessions already have.

Cross-platform sync is the load-bearing requirement. Every architectural choice defers to: *a memory authored under one adapter is read back unchanged under another* (semantic round-trip of `{name, description, queries, body}` per the memex-hermes golden-fixture contract).

## 2. Non-goals (v1)

- Replacing Codex's native skill system (`~/.codex/skills`, `.agents/skills`) — we **index and route** them, not duplicate the loader.
- Replacing Codex's experimental native memories (`memories` feature / `memories_*.sqlite`, Chronicle) — v1 **coexists**; interop modes deferred (§6.4).
- Building the flotilla **surface driver** for Codex (owned by `codex-harness-dev`).
- Shipping daemon/IPC mode (`memex --serve`).
- OpenAI plugin marketplace publication (follow-up after local plugin + conformance gates pass).
- **Option B (v1):** MCP `memex_remember` / `memex_search` / `memex_recall` tools via plugin `mcpServers` — deferred to Phase 7+ (§5.6).

### 2.1 memex-claude capabilities explicitly dropped or deferred (no silent loss)

| memex-claude surface | v1 disposition | Rationale |
|---------------------|----------------|-----------|
| `SleepScheduleConfig` + `bin/sleep-schedule.sh` crontab setup | **Non-goal v1** | No Codex cron path; `handleSessionStart` cron branch omitted |
| `cronWatermarkPath` | **Non-goal v1** | Sleep-schedule only |
| `autoMemoryWatermarkPath` + Claude auto-memory conflict warning | **Non-goal v1** | Targets `CLAUDE_CODE_DISABLE_AUTO_MEMORY`; no Codex analogue |
| `autoMemoryMode` (`assist` / `takeover`) + SessionStart branches | **Non-goal v1** | Deferred to §6.4; unrelated to memory **write** path (§5.6) |
| Plugin skills: `sleep`, `deep-sleep` | **Non-goal v1** | Require cron |
| Plugin skills: `reflect`, `wrap-things-up`, `takeover` | **Phase 5** | Handoff workflows after `help`/`doctor`/`handoff` |
| Stop-hook `extractLearnings` | **Phase 4** | Requires SQLite/session-end design (§4.5); not `transcript_path` |

**v1 ships:** plugin skill `memory-creation` (bundled, read-on-demand) — supports Option A agent write path (§5.6).

## 3. Adapter pattern survey — template vs conformance roles

### 3.1 Role split (1b-P2-3)

| Repo | Role for memex-codex | Writer? | Golden fixtures? |
|------|---------------------|---------|------------------|
| **memex-claude** | **Hooks/dispatch/paths template** | **No** — grep `memex_remember` / `formatMemory` in `memex-claude/src` → empty | **No** — consumes corpus, does not define writer contract |
| **memex-hermes** | **Conformance + writer contract** | **Yes** — `memex_remember` harness tool + `formatMemoryEntry` | **Yes** — `test/fixtures/cross-adapter/` |
| **memex-core** | Shared engine (parse, index, sync) | **No** — `formatMemoryEntry` **not** in core (grep confirms) | Reader only |

memex-codex ports **claude's hook architecture** and satisfies **hermes's on-disk writer contract** via Option A (agent writes, §5.6) — not hermes's harness-tool invocation path.

### 3.2 memex-claude — hooks template

| Concern | Implementation |
|---------|----------------|
| **Injection** | Plugin `hooks.json` → command hook `bin/memex` |
| **I/O** | JSON stdin `HookInput` → JSON stdout `HookOutput` (`additionalContext`) |
| **Events** | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` |
| **Write path** | Agent hand-writes `.md` files (takeover mode injects `memory-creation` **rule** via `session-start.ts:62-98`; no binary writer) |
| **Sync repo** | `~/.local/share/memex-claude/` |

### 3.3 memex-hermes — conformance authority

| Concern | Implementation |
|---------|----------------|
| **Write path** | `memex_remember` tool → binary `Hermes.tool-remember` → `formatMemoryEntry` |
| **Fixtures** | `golden-memory-*.md` + Tier 1/2/3 tests |
| **Sync repo** | `~/.local/share/memex-hermes/` |

### 3.4 Pattern decision for Codex

Codex hook system is **Claude-isomorphic** (binary-verified §4.8). Implement as **Codex plugin → command hooks → compiled memex binary**. **Not** a Python shim; **not** in-process TS (openclaw); **not** harness tools (hermes) in v1.

## 4. Codex CLI extension surface (0.142.5)

### 4.1 Hooks (primary injection surface — verified)

**Discovery** (all layers merge; matching hooks all run):

| Layer | Path |
|-------|------|
| User | `~/.codex/hooks.json` or `[hooks]` in `config.toml` |
| Project | `<repo>/.codex/hooks.json` |
| **Plugin-bundled** | `hooks.json` in installed plugin dir (manifest key confirmed); command path uses `${PLUGIN_ROOT}` (binary-verified; `CLAUDE_PLUGIN_ROOT` alias also present) |

**Per-event output wire** (binary-verified): each hooked event has a `*HookSpecificOutputWire` schema; context injection uses `AdditionalContextEntry` / `additionalContext` array — same semantics as memex-claude's `HookOutput.additionalContext` string (adapter emits the JSON shape Codex expects; spike confirms exact wire in Phase 1).

**Trust gate** (binary-verified): non-managed hooks require `/hooks` review (`HookTrustStatus`, `trusted_hash`). Two bypass paths exist — document both, default to neither for operator installs:

| Mechanism | Form |
|-----------|------|
| CLI flag | `--dangerously-bypass-hook-trust` (per-invocation; message in binary) |
| Config override | `bypass_hook_trust = true` in `config.toml` (boolean; binary validates type) |

There is **no** `codex hooks` subcommand — hook management is via `/hooks` in the interactive CLI and `config.toml` / `hooks.json` files.

**Hook input** (binary-verified event names): `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `PostCompact`, `PermissionRequest`, `SubagentStart`, `SubagentStop`, `Stop`. Phase 1 captures actual stdin field names per event.

### 4.2 AGENTS.md (static — not memex injection)

Codex loads `AGENTS.md` / `AGENTS.override.md` from `~/.codex/` + repo walk. Docs describe a default size cap via `project_doc_max_bytes` (commonly cited as 32 KiB — **documented default, not independently verified on this host**). Memex uses hook `additionalContext`, not AGENTS.md.

### 4.3 Skills

| Scope | Path |
|-------|------|
| User | `~/.codex/skills/` |
| Repo | `.agents/skills` (walk to root) |
| Plugin | `skills/` in `.codex-plugin/plugin.json` |

### 4.4 Config.toml

- `$CODEX_HOME` (default `~/.codex/`)
- `[features] hooks = true` (stable)
- `[features] memories` — experimental; off by default
- `codex features list` shows `plugin_hooks` as **removed** = graduated into stable `plugins` + bundled `hooks.json` — **not** absent

### 4.5 Session persistence — dual store, no Stop `transcript_path`

**Cross-desk ground truth** (codex-harness-dev, codex-cli 0.142.5, PR #259 `internal/codexstore/`):

| Artifact | Purpose |
|----------|---------|
| `~/.codex/sessions/YYYY/MM/DD/rollout-<timestamp>-<uuid>.jsonl` | **Canonical turn log** — full agent/user text the pane tail omits |
| `state_*.sqlite` | Thread index (resume, fork) alongside rollouts |
| `logs_2.sqlite` | Conversation logs (secondary; Phase 4 fallback) |

Rollout resolution: first `session_meta` line carries `payload.cwd`; match desk worktree (`filepath.Clean`) → newest rollout filename wins. Agent text shapes (both must be handled):

- `{"type":"event_msg","payload":{"type":"agent_message","message":"..."}}`
- `{"type":"response_item","payload":{"type":"message","role":"assistant","content":[{"type":"output_text","text":"..."}]}}`

**Stop-hook stdin:** `transcript_path` is still **expected absent** (Claude-isomorphic hook wire, not rollout path). Phase 1 captures Stop payload fields to confirm. Phase 4 learnings/behavioral rules read rollout JSONL (preferred) or SQLite — **reuse flotilla `codexstore.LatestResult` / `ReplyAfter`**, do not duplicate rollout parsing (§8).

| memex-claude Stop feature | Codex v1 |
|---------------------------|----------|
| Behavioral stop-rules (`getLastAssistantResponse(transcript_path)`) | Phase 4: `codexstore.LatestResult(CODEX_HOME, cwd)` or Stop stdin fields |
| `extractLearnings` | Phase 4: rollout JSONL scan or Stop payload + `logs_2.sqlite` fallback |

Phase 1 spike: capture Stop **payload** fields; injection proof (1b) is model-visible `additionalContext`, with harness `ReplyAfter` as independent corroboration.

### 4.6 Plugin manifest (verified keys)

```
memex-codex/
  .codex-plugin/plugin.json   # hooks, skills, mcpServers keys confirmed in binary
  hooks/hooks.json            # v1 primary integration surface
  skills/                     # help, doctor, handoff, memory-creation
  bin/memex
  bin/install.sh
```

Install: `codex plugin marketplace add` → `codex plugin add` → `codex plugin list` (all confirmed in 0.142.5 binary).

**v1 uses `hooks` + `skills` only.** `mcpServers` reserved for Option B (§5.6 Phase 7+).

### 4.7 Fleet launch + project rules (codex-harness-dev)

| Concern | Value |
|---------|-------|
| Fleet launch | `codex -m gpt-5.5-codex --sandbox workspace-write --ask-for-approval on-request` |
| Static identity | `AGENTS.md` from cwd (native load; no `--append-system-prompt`) |
| Hook trust gate | `"Hooks need review"` + Press enter — first session after hook change; `/hooks` review |
| Context reset | `/clear` slash command (flotilla `Rotate`) |
| Project rules | `<worktree>/.codex/rules/flotilla-desk.rules` — **defense-in-depth** no-self-merge backstop (PR #259 fix round): `gh pr merge` forbidden; default-branch `git push` + force-push forbidden; feature-branch push + `git merge origin/main` **allowed** (prefix_rule argv-prefix limits — doctrine + gate stack are real control) |

Memex adapter does **not** own surface-driver state chrome; harness owns `parseCodexState` probes (login, hooks gate, approval, working).

### 4.8 Binary-verified surface (stop hedging)

Confirmed in codex-cli **0.142.5** binary strings / wire types (COS spot-check):

- All 10 hook event names listed in §4.1
- Per-event `*HookSpecificOutputWire` + `AdditionalContextEntry`
- Plugin manifest: `hooks`, `skills`, `mcpServers` keys
- Trust internals: `HookTrustStatus`, `trusted_hash`, `/hooks` TUI path
- `codex plugin add` / `list` / `marketplace` commands

## 5. Cross-adapter conformance

### 5.1 Guarantee

Semantic round-trip of `{name, description, queries, body}` — not byte-identical filenames.

### 5.2 Fixtures (hermes-owned — writer contract authority)

**Contract freeze pointer (memex XO confirmed 2026-07-03):** pin **`memex-hermes` `main` @ `edf1bf6`**. Paths stable on main:

| Artifact | Path (under hermes repo) |
|----------|--------------------------|
| Fixtures | `test/fixtures/cross-adapter/golden-memory-frontmatter.md`, `test/fixtures/cross-adapter/golden-memory-section.md`, `test/fixtures/cross-adapter/golden-memory-prose.md` + `README.md` |
| Tier 1 tests | `test/ts/cross-adapter-compat.test.ts` (read/write/round-trip, **#10-boundary**, prose→`[]`) |
| Tier 2 tests | `test/ts/cross-adapter-pin-alignment.test.ts` |
| Design authority | `design/cross-adapter-byte-compat-golden.md` |

| Fixture | Proves |
|---------|--------|
| `golden-memory-frontmatter.md` | L1a `formatMemoryEntry` shape — **byte contract** |
| `golden-memory-section.md` | L1b section parser |
| `golden-memory-prose.md` | Pinned prose → `parseMemoryFile` → `[]` (#12) |

memex-claude does **not** consume these fixtures; memex-codex **does** (reader + format reproducer via replicated `formatMemoryEntry`, not hermes-tool writer). **Vendor/copy fixtures into `memex-codex`** at freeze SHA — do not symlink a private hermes checkout in CI.

### 5.3 Test tiers (revised for Option A)

| Tier | Runner | Scope |
|------|--------|-------|
| **1** | vitest (always-on) | **Read:** `parseMemoryFile` / `parseFrontmatter` on all golden fixtures. **Write-shape:** vendored `formatMemoryEntry` output bytes == `golden-memory-frontmatter.md` for pinned input (same as hermes Tier-1 write conformance). **Format-instruction:** static test that `memory-creation` skill body + `formatMemoryEntry` spec reproduces golden bytes (Option A conformance node). |
| **2** | vitest (always-on) | Dependency alignment (below) |
| ~~**3**~~ | ~~pytest e2e~~ | **Removed for v1** — Tier 3 targets `memex_remember` binary dispatch (hermes harness tool). Inapplicable under Option A. Reintroduce only if Option B ships (§5.6). |

**Tier-2 pin policy (verified @ `edf1bf6`):**

| Package | Declared range | **Resolved (assert `===`)** | Load-bearing? |
|---------|----------------|----------------------------|---------------|
| `@jim80net/memex-core` | `^0.4.0` | **`0.4.0`** | **Yes** |
| `@huggingface/transformers` | `^3.8.1` | **`3.8.1`** | **Yes** |

Caret ranges are documentary only; Tier-2 tests assert installed resolved versions.

### 5.4 Writer obligation — replicate, swap-ready

`formatMemoryEntry` is in **memex-hermes** (`src/core/memory-format.ts` + `safeYamlScalar`) — **not** in memex-core today and **not** npm-importable (hermes is private). memex-codex **replicates** the 5-line frontmatter block shape; **golden-memory-frontmatter.md bytes are the contract** (match exactly = shape match).

**Upstream (#20, track don't block):** centroid design (`design/knowledge-lifecycle-centroid-20`) proposes relocating `formatMemoryEntry` into memex-core — `[awaiting-auth]` operator decision, gated on #10; no target PR yet. Structure replicated code so a future `@jim80net/memex-core` import is a drop-in swap; memex XO will ping when it lands.

**In-flight pins (flip in lockstep with hermes):**

| Issue | Behavior memex-codex must pin |
|-------|------------------------------|
| **#10** | Embedded `"/\` in frontmatter scalars do **not** round-trip (colon/unicode/trailing-space do); carry boundary test from hermes Tier 1 |
| **#12** | Heading-less prose → `parseMemoryFile` → `[]`; `golden-memory-prose.md` pins it |

### 5.5 Coordination — **CONFIRMED** (memex XO 2026-07-03)

| Ask | Answer |
|-----|--------|
| Fixture stability | **Stable** on `main` @ `edf1bf6` — adopt 3 fixtures + Tier 1+2 tests + design doc |
| `formatMemoryEntry` upstream | **Planned**, not before memex-codex ships; replicate now, swap on memex ping |
| Pin baseline | `@jim80net/memex-core` **`0.4.0`**, `@huggingface/transformers` **`3.8.1`** (resolved) |

**Phase 3 conformance work is unblocked** (auth-independent; parallel to Phase 1 live spike).

### 5.6 Memory write path — **Option A** (P1 resolution)

**Decision: Option A** — agent-authored files with format guidance (memex-claude model). **Not Option B** (MCP tools) in v1.

| | Option A (chosen v1) | Option B (deferred Phase 7+) |
|--|---------------------|------------------------------|
| **Mechanism** | Codex Write/Edit → `~/.codex/memex/projects/<encoded>/memory/*.md` | Plugin `mcpServers` exposing `memex_remember` / `memex_search` / `memex_recall` |
| **Harness registration** | None — hooks cannot register callable tools | MCP tool surface (hermes-like) |
| **Guidance** | Bundled `memory-creation` skill; agent reads `SKILL.md` on demand | Tool schemas in system prompt |
| **Conformance** | Tier 1 read + `formatMemoryEntry` byte match + format-instruction static test | Would restore hermes Tier 3 e2e |
| **Justify** | Matches primary template (memex-claude); minimal v1 surface; cross-harness read path identical; writes land in same sync-repo layout after `Stop` sync | Adds MCP trust/config surface; only needed if agent-disciplined writes prove insufficient |

**Runtime write flow (v1):**

```
Agent decides to remember
  → reads plugin skill memory-creation/SKILL.md (or prior injection)
  → Write/Edit tool → ~/.codex/memex/projects/<encoded>/memory/<file>.md
  → format matches formatMemoryEntry (frontmatter contract)
  → Stop hook (when enabled) → syncCommitAndPush → ~/.local/share/memex-codex/
  → other adapters read via shared parser
```

## 6. Proposed architecture

```
Codex CLI → plugin hooks.json → bin/memex → memex-core
                ↓                              ↓
     additionalContext (read path)     ~/.codex/memex/projects/... (write path, agent)
                                                ↓
                              ~/.local/share/memex-codex/ (git sync)
```

### 6.1 Path layout (`codex-paths.ts`)

`MemexPaths` requires `projectsDir` + `globalRulesDir` (`memex-core/src/types.ts:162-172`).

**`projectsDir` (unambiguous):** `join(CODEX_HOME, "memex", "projects")` — dedicated memex namespace under Codex home. **Not** `~/.codex/projects/` (could collide with future Codex layouts). **Not** harness-populated — memex creates on first `registerProject` / agent write.

| Path | Field | Purpose |
|------|-------|---------|
| `~/.codex/memex.json` | — | Config (no `sleepSchedule` / `autoMemoryMode` v1) |
| `~/.codex/cache/` | `cacheDir` | Cache root |
| `~/.codex/cache/memex-cache.json` | — | Embeddings cache |
| `~/.codex/cache/models/` | `modelsDir` | ONNX models |
| `~/.codex/cache/sessions/` | `sessionsDir` | Rule-disclosure state |
| `~/.codex/cache/memex-telemetry.json` | `telemetryPath` | Telemetry |
| `~/.codex/cache/memex-projects.json` | `registryPath` | Project registry |
| `~/.codex/cache/memex-traces/` | `tracesDir` | Traces |
| `~/.local/share/memex-codex/` | `syncRepoDir` | Git sync |
| `~/.codex/memex/projects/` | `projectsDir` | **Local** project memory base (`getProjectMemoryDir` → `<encoded>/memory/`) |
| `~/.codex/skills/` | `globalSkillsDir` | Indexed |
| `""` | `globalRulesDir` | **Placeholder** — unused; rules via `type: rule` in skillDirs |
| Sync `projects/<encoded>/memory/` | — | Cross-harness corpus |

**`getProjectMemoryDir(cwd, projectsDir)`** → `~/.codex/memex/projects/<encodeProjectPath(cwd)>/memory/`. Works without any Codex-native projects tree — memex owns directory creation.

### 6.2 Hook event mapping (v1)

| Event | Action | Default |
|-------|--------|---------|
| `SessionStart` | Registry + sync pull; **no** sleep/cron/auto-memory/memory-creation injection (§2.1) | On if `enabled` |
| `UserPromptSubmit` | Semantic search → `additionalContext` | **`enabled: true`** |
| `PreToolUse` | Tool guidance | **`enabled: false`** |
| `Stop` | Sync commit/push; behavioral rules; learnings | **`enabled: false`** (memex-claude `config.ts:76-77`). No-op unless operator opts in. Behavioral rules use rollout JSONL via `codexstore` (§4.5); learnings Phase 4. |

### 6.3 Scan dirs

```typescript
// projectsDir = join(CODEX_HOME, "memex", "projects")
memoryDirs: [
  getProjectMemoryDir(cwd, paths.projectsDir),
  ...syncMemDirs,
  ...config.memoryDirs,
],
ruleDirs: [],
```

### 6.4 Native Codex memories — defer / authoritative (deferred)

Unrelated to `autoMemoryMode: "takeover"` (§2.1). v1: ignore `memories_1.sqlite`.

## 7. Repo placement

**Sibling `jim80net/memex-codex`** — see v1.1 rationale. `codex-memex-dev` worktree: design + spike + core prerequisites only.

## 8. codex-harness-dev coordination

**Division:** harness-dev owns surface driver + session-store reader; this desk owns memex plugin + hook injection.

**Landed (PR #259, branch `codex-harness-dev`):** `internal/surface/codex.go` + `internal/codexstore/codexstore.go` — rollout JSONL paths, `session_meta.payload.cwd` resolution, agent text extraction. **memex-codex Phase 4 MUST import or mirror this package** — no second rollout parser.

**Shared assumptions (both desks blocked on operator `codex login` for live fixtures):**

| Topic | Harness | Memex adapter |
|-------|---------|---------------|
| Session store root | `~/.codex/sessions/…/rollout-*.jsonl` | Same — Phase 4 learnings |
| Cwd correlation | `session_meta.payload.cwd` | Hook stdin `cwd` field (Phase 1 capture) |
| Hook trust | `codexIsHooksGate` chrome | Plugin install triggers gate; spike uses project `.codex/hooks.json` |
| Result read | `LatestResult` / `ReplyAfter` | Phase 1b corroboration; not primary injection gate |

**Memex-specific hook/config discoveries (2026-07-02, pre-auth unless noted):**

- Hook layers **merge** — user `~/.codex/hooks.json` + project `<repo>/.codex/hooks.json` + plugin-bundled all run (binary-verified §4.1).
- Trust strings match harness: `"Hooks need review"` + Press enter (binary-sourced; live capture pending auth).
- `UserPromptSubmit` pipe-capture stdin keys: `cwd`, `hook_event_name`, `prompt`, `session_id` — live session may add fields (Phase 1a).
- `additionalContext` wire confirmed: pipe smoke emits `{"additionalContext":"memex-spike: injection marker 7f3a"}` (Phase 1b pending model turn).
- `projectsDir` = `~/.codex/memex/projects/` (memex-owned; not Codex-native projects tree).
- Stop hook default **`enabled: false`** — fleet `install.sh` must opt in for cross-harness write sync (§6.2).
- v1 hooks: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` only; `PostToolUse`+ deferred.
- Phase 1 gate requires **plugin-bundled** `hooks.json` (Phase 1c); project hooks are dev convenience only.

## 9. Implementation plan

| Phase | Deliverable | Gate |
|-------|-------------|------|
| **0** | Design v1.2 + COS final gate | Dual reviewer clean |
| **1** | Spike: **plugin-installed** hooks fire; **UserPromptSubmit** returns `additionalContext` **visible in model turn**; capture stdin JSON per event; confirm no `transcript_path` on Stop | Field names + injection proof |
| **2** | `memex-codex` scaffold + handler port | CI green |
| **3** | Tier 1+2 conformance (fixtures @ `edf1bf6`, replicated `formatMemoryEntry`, #10/#12 pins) | vitest green |
| **4** | Session-end learnings design (rollout JSONL via `codexstore`; Stop payload; SQLite fallback) | Design spike |
| **5** | Install + `help`/`doctor`/`handoff`/`memory-creation` skills | Dogfood |
| **6** | Cross-harness sync read after agent write | Merge-ready |

**Install-time note (non-blocking, ship-live):** Default config keeps `hooks.Stop.enabled: false` (template-isomorphic with memex-claude `config.ts:76-77`). Cross-harness **write** sync (`syncCommitAndPush` in `stop.ts:61`; pull in `session-start.ts:54`) is therefore **dormant on default install**. Fleet `install.sh` / setup docs **must** set `hooks.Stop.enabled: true` (or equivalent operator opt-in) so Codex-authored memories reach `~/.local/share/memex-codex/`. Phase 6 merge-ready gate exercises this path — keep it.
| **7+** | Option B MCP tools (if agent writes insufficient) | Operator decision |

**Phase 1 additions (1b-P3b/c):** project `.codex/hooks.json` is dev convenience only; **gate requires plugin-bundled `hooks.json` via `codex plugin add`**. Staged spike in this worktree validates hook stdin shape; injection proof requires post-login plugin install.

## 10. Risks

| Risk | Mitigation |
|------|------------|
| Agent writes malformatted memory files | `memory-creation` skill + Tier 1 format tests |
| No Stop `transcript_path` | Phase 4 rollout JSONL via flotilla `codexstore` |
| Hook trust friction | `/hooks` + install docs |
| #10 grammar fix lands in hermes | Flip boundary pin in lockstep |

## 11. Verification

- Tier 1+2 vitest (no Tier 3 v1)
- Phase 1: plugin hooks + `additionalContext` in model
- Cross-harness: memory written in Claude sync repo → readable in Codex index

## 12. References

- [Codex hooks](https://developers.openai.com/codex/hooks)
- [Codex plugins / build](https://developers.openai.com/codex/plugins/build)
- `memex-hermes/design/cross-adapter-byte-compat-golden.md` (freeze @ `edf1bf6`)
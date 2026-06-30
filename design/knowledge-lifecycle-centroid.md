# Design — memex-core as the memory/skill/rule lifecycle centroid (#20 / Option A)

**Status:** proposed (chapter kickoff; standard flow → review trio → impl)
**Decision:** operator, 2026-06-30 — *"#20 Option A; let's have memex-core become the
de facto centroid for memory / skill / rule management."*
**Tracking:** memex-hermes#20 (parent, carries the audit). Cross-repo: memex-core
(primary) + the adapter repos (memex-claude/hermes/grok/openclaw thin out).
**Author:** memex flotilla XO · grounded in the audit on #20.

## 1. Problem (from the audit)

Knowledge-lifecycle management — **ingesting** the operator's standing sources
(`CLAUDE.md`, `~/.claude/rules/*`, `MEMORY.md`) into the shared corpus, and
**promoting/demoting** entries by match telemetry — today lives entirely in the
**memex-claude `/sleep` skill** (`memex-claude/skills/sleep/SKILL.md`), a
prompt-driven, manually-invoked, claude-specific routine. Consequences (verified):

- **Adapter-bound + manual:** Hermes/Grok have no equivalent; it runs only when a
  human invokes `/sleep` on a claude host. The corpus `rules/` was populated by
  ad-hoc *"sync from VENGEANCE"* commits, not a systematic core process.
- **Incomplete + host-skewed:** the shared corpus carries only **5 of the
  operator's 23 standing rules**, and the **`CLAUDE.md` 4-Cs constitution is not
  ingested at all**. So a desk switched off Claude (the #18 portability headline)
  silently loses most of how the operator works.

The operator's decision (A): **make memex-core the centroid** — the neutral
substrate that owns the lifecycle, so every adapter shares one complete,
harness-neutral path and `.claude/` becomes a *projection* of the corpus.

## 2. The key architectural seam: mechanism (core) vs judgment (adapter)

The `/sleep` 10-step process is two kinds of work intermixed:

| Kind | Examples (from the skill) | Belongs in |
|------|---------------------------|------------|
| **Deterministic mechanism** | gather sources by path; parse/emit frontmatter (`name`/`description`/`queries`/`one-liner`/`type`); write corpus entries; dedup by name/content; read telemetry; compute matchCount/lastMatched math; promote/demote *threshold checks*; file moves/cleanup; commit+push (the existing sync) | **memex-core** (a first-class API) |
| **LLM judgment** | which `CLAUDE.md` sections are *durable standards* vs task-specific; authoring good `queries` for a new entry; the *decision* to promote/demote a borderline entry; `boost` tuning | **adapter** (prompted), but **calling core APIs** |

So the centroid is NOT "move the whole skill into core." It is: **lift the
deterministic machinery into core as callable functions; keep the judgment in the
adapter as a thin wrapper that supplies LLM decisions to those functions.** This
preserves the human-in-the-loop judgment the skill relies on while making the
machinery shared, complete, and harness-neutral.

## 3. Proposed memex-core API (new `lifecycle` module)

A new `src/lifecycle.ts` (exported from `index.ts`), building on what already
exists (`skill-index.ts` parse/index, `sync.ts` commit/push, `telemetry.ts`,
`cache.ts`, `file-lock.ts`):

- `gatherStandingSources(paths): StandingSources` — read `CLAUDE.md` (+ project
  `CLAUDE.md`), `rules/*`, `MEMORY.md` from the configured locations; return their
  parsed content. Deterministic.
- `ingestRule(entry, syncRepoDir, opts): IngestResult` — write a `type: rule`
  corpus entry (frontmatter via the same `safeYamlScalar`/format contract the
  adapters use — candidate to share with memex-hermes's `memory-format`), dedup
  against existing, into the synced corpus. Deterministic.
- `ingestConstitution(sections, syncRepoDir): IngestResult[]` — given
  caller-supplied *durable* `CLAUDE.md` sections (the JUDGMENT input), write each
  as a `type: rule` corpus entry. The **carving** of CLAUDE.md into durable
  sections is the adapter's LLM call; the **writing** is core.
- `reviewLifecycle(telemetry, index, policy): LifecyclePlan` — apply the
  deterministic threshold rules (promote memory with matchCount>N across
  sessions>M; demote stale rule) → a *plan* of proposed promotions/demotions for
  the adapter to approve. Pure function over telemetry.
- `applyLifecyclePlan(approvedPlan, syncRepoDir)` — execute the approved moves
  (write/move/cleanup + commit). Deterministic.

Adapters' `/sleep`-style skills become **thin wrappers**: gather (core) → ask the
LLM the judgment questions → call ingest/apply (core). New for Hermes/Grok: a
small wrapper each; they inherit the complete ingest for free.

## 4. Completeness (closes the #20 gap)

The centroid makes the ingest **complete and repeatable**, not a partial manual
artifact: a `ingestAllStanding()` convenience that ingests the *full* rule set +
the durable `CLAUDE.md` constitution into the shared corpus, runnable on a
lifecycle event (session-end / `/sleep`) consistently across adapters — so the
operator's standing constraints reach the corpus regardless of harness, and stay
current. (Whether the trigger is manual-only, automatic-on-event, or both is an
open question — §6.)

## 5. Cross-repo plan (multi-PR, sequenced)

1. **memex-core:** add the `lifecycle` module + tests; bump minor; (reconcile with
   the stale 0.5.0 release PR). No breaking changes to existing exports.
2. **memex-claude:** refactor `/sleep` to call the core API (thin wrapper);
   backward-compatible — same human workflow, machinery now shared.
3. **memex-hermes / memex-grok / memex-openclaw:** add the thin lifecycle wrapper
   so every adapter shares the complete ingest.
4. **Backfill:** one-time `ingestAllStanding()` run to close the current 5/23 +
   no-constitution gap in the shared corpus.

## 6. Open questions (for the review trio)

- **Mechanism/judgment line:** is the split above right, or do some "judgment"
  bits (e.g. durable-section detection) have a deterministic-enough heuristic to
  live in core? Risk: putting LLM judgment in core (it has no LLM).
- **Format sharing:** memex-hermes already extracted a `memory-format` module
  (#4). Should the frontmatter writer be a single core-owned formatter the
  adapters import (the natural centroid consequence)? Likely yes — fold it in.
- **Trigger:** manual `/sleep` vs automatic on session-end vs both. Automatic
  risks noisy churn (cf. the per-write vs batch debate in #6); manual risks the
  current incompleteness. Lean: core provides the capability; adapters choose the
  trigger; default to an explicit lifecycle event, not every turn.
- **Constitution carving:** the `CLAUDE.md` 4-Cs etc. — deterministic section
  split (by `##` headings) + an adapter LLM "is this durable?" gate, or fully
  LLM? Avoid fabricating durability judgments.
- **Promotion writes back to `~/.claude/rules`:** the skill moves entries between
  front-of-context (`rules/`) and back-of-context (skills). The centroid must
  preserve that bidirectional flow without a claude-specific path assumption.

## 7. Out of scope
- The Discord category/group setup (CoS / #207).
- The #18 HarnessContinuityBundle consumer (gated on grok's bundle); this centroid
  is its upstream prerequisite — once the constraints are in the corpus, the
  bundle has real content to surface.
- Replacing the human judgment in `/sleep` with automation — the centroid lifts
  the machinery, not the judgment.

## 8. Verification plan
- memex-core unit tests for each lifecycle function (ingest rule/constitution,
  dedup, telemetry plan thresholds, apply-plan file ops) — deterministic, no LLM.
- A round-trip: ingest a sample rule + CLAUDE.md section → corpus → `SkillIndex`
  surfaces it; promote/demote plan matches expected thresholds.
- An adapter integration check (memex-claude `/sleep` wrapper) that the human
  workflow is unchanged and the machinery now routes through core.

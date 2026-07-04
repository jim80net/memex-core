# Design — memex-core as the memory/skill/rule lifecycle centroid (#20 / Option A)

**Status:** proposed (chapter kickoff; standard flow → review trio → impl)
**Decision:** operator, 2026-06-30 — *"#20 Option A; let's have memex-core become the
de facto centroid for memory / skill / rule management."*
**Tracking:** memex-hermes#20 (parent, carries the audit). Cross-repo: memex-core
(primary) + the adapter repos (memex-claude/hermes/grok/openclaw thin out).
**Author:** memex flotilla XO · grounded in the audit on #20.

## 0a. FIRM REQUIREMENT — the three-tier TRUST model (rev3, CoS/operator directive 2026-07-04)

The operator named web-scanning / R&D lanes a **prompt-poisoning attack vector**.
Consequence for this centroid: the corpus is not a flat store — it is **trust-tiered**,
and the audience decision below (§0) decides tier **boundaries, NOT whether tiers
exist**. Every corpus entry carries a **trust tier + provenance**, and injection
authority is gated by tier:

| Tier | Contents | Injection authority |
|------|----------|---------------------|
| **TRUSTED** | operator doctrine / identity / rules (the `CLAUDE.md` constitution, the standing rules) | **Authoritative + always-on** — feeds the always-injected channel every harness must have (memex-hermes#26). This is doctrine. |
| **SHAREABLE** | project/episodic memory, skills — the private-vs-shareable partition the operator's §0 decision partitions | Retrieval + (per policy) injection; not identity/doctrine |
| **UNTRUSTED-INGESTED** | R&D / web-derived findings | **Gated, provenance-labeled, retrieval-only** — NO agent may treat it as doctrine/identity/rules; NEVER feeds authoritative injection. Surfaced with an explicit "untrusted source, provenance=<x>" wrapper so the model can weigh but not obey it. |

**Centroid consequences (firm, independent of the §0 audience decision):**
- `ingestRule`/`ingestConstitution` tag entries **TRUSTED**; a new `ingestObservation(entry, provenance)` writes **UNTRUSTED-INGESTED** with a required provenance field and an `untrusted: true` marker in frontmatter.
- The lifecycle's injection/plan functions MUST partition by tier: only TRUSTED (and, per the §0 decision, SHAREABLE) feed authoritative/always-on injection; UNTRUSTED is retrieval-only and always provenance-wrapped.
- The corpus `type`/frontmatter schema gains a `trust` + `provenance` field (memex-core owns it as the centroid).
- A poisoned web finding entering via an R&D lane therefore CANNOT become doctrine — it lands UNTRUSTED, labeled, never authoritatively injected. (This is the attack-surface fix.)
- Ties to memex-hermes#26 (trusted tier → authoritative always-on injection) — the injection half of the same model.

Full spec: flotilla#369 + fleet-ops operator-preferences R&D section.

## 0. Review-trio verdict + the GATING decision (rev2 — read first)

systems-review + open-code-review + STORM on rev1. Verdict: **the mechanism/judgment
cut is the right architecture (credited)**, but the build is **gated on one operator
decision**, and the trio surfaced a sharper, cheaper sequencing.

**🔴 GATING OPERATOR DECISION — the corpus AUDIENCE MODEL `[awaiting-auth]`.**
`ingestAllStanding()` would push the operator's **private operating doctrine**
(the `CLAUDE.md` 4-Cs constitution + the 23 standing rules — some naming account
behavior, deployment habits, painful-memory retrospectives) into the shared
corpus `claude-skill-router-corpus`. That repo is **PRIVATE today (verified
isPrivate:true)**, so it is *not* a live leak — but the whole point of the
centroid is cross-adapter/host sharing, and the fleet has a `take-repo-public`
path. So **whether the constitution is corpus-eligible depends on the corpus's
audience model**: single-operator-private-forever vs eventually shared / federated
/ public. This is a privacy + positioning call only the operator can make, and it
gates what `ingestAllStanding` may include. **Surfaced; build holds on it.**

**Scoping insight (strong, from STORM + the Skeptic):** the #18/#20 portability
win is *content reaching the corpus*, which a **one-time, audience-gated backfill**
achieves — ~100% of the portability win for ~10% of the build. The recurring
`lifecycle.ts` centroid is the larger bet, and ~70% of `/sleep`'s value is LLM
**judgment** that each harness still hand-authors (adapters inherit the *writing*,
not the *deciding* — rev1's "inherit for free" was half-true). **Recommendation:
do the cheap backfill first (once the audience model is decided), then evaluate
the full centroid** — don't freeze a claude-shaped, privacy-unscoped lifecycle
into the neutral substrate before the two unknowns (audience model; other-harness
injection models) are answered.

**Key correction (storage ≠ injection):** corpus membership is *back-of-context*
(semantically searched), NOT *always-loaded*. This dissolves the completeness-vs-
curation tension (store all 23, surface only the relevant via search) and scopes
the privacy question (it's about *what is stored in a shareable repo*, not about
front-loading). It also reframes promote/demote (§6).

**Other trio fixes (recorded here; to integrate into §2–§6 on the post-decision pass):**
(a) semantic dedup is NOT deterministic (it's
embedding-similarity ≥80%) → moves to the judgment/adapter side; core offers a
`findSimilar()` *query* only (§2/§3). (b) The centroid would be a **4th
uncoordinated writer to the sync git tree** — exactly memex-hermes **#15** (OPEN);
core's `withFileLock` is per-*file*, not a tree lock → #15's repo-scoped lock is a
**prerequisite** (§5). (c) The **trigger** (manual vs automatic) is ratified, not
deferred: core = idempotent batch *capability*; adapter chooses the trigger;
default an explicit lifecycle event (§6). (d) Folding the formatter into core is a
**relocation** (`safeYamlScalar`/`formatMemoryEntry` live in memex-hermes today;
core would own them and hermes re-imports) and must **own both read+write sides —
closing #10** (embedded `"`/`\` round-trip) — or be gated on #10; re-point the #4
conformance test. (e) `reviewLifecycle` is pure over **(telemetry × index)** (type
lives in the index, not telemetry); thresholds are **config policy**, not magic
numbers. (f) `ingestRule` can't reuse the **directory-shaped** `syncCommitAndPush`
— it needs an entry-shaped sync primitive (§3).

## 1. Problem (from the audit; counts as-of the #20 audit, 2026-06-30)

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

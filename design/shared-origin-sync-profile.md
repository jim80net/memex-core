# Design — Shared origin + sync profile (file-shaped projection)

**Status:** draft for flotilla gate (design only — **no impl until gated**)  
**Authority:** operator product steer `flotilla-dispatch-c29001c1` (2026-07-10)  
**Brief:** `~/workspace/memex-flotilla/briefs/file-rules-shared-origin-2026-07-10.md`  
**Hierarchy:** `a1-fleet-ops/state/hierarchy/memex.yaml` → `product_direction`  
**Owner (this doc):** memex-core product XO — core primitives only  
**Companion:** memex-grok design addendum (adapter projection + doctor + CLI) — **not** this PR  
**Related designs:** `knowledge-lifecycle-centroid.md` (#20 lifecycle), `knowledge-scope-three-tier.md` (fleet/flotilla/desk layout)

---

## 0. Bottom line

Memex-core owns a **shared origin** (canonical on-disk corpus for rules / skills / memories) and a **harness-neutral sync profile** that tells adapters *when* and *where* to project that origin into harness dirs via **symlinks**. Full lifecycle of content stays in Memex; adapters project, they do not invent a second store. Refinement feedback loops stay deferred — leave API seams, invent nothing.

This chapter is **file-shaped + provenance-inspectable** (`readlink` → origin). It de-emphasizes opportunistic live injection (especially Grok).

---

## 1. Verified current state (no invention)

Claims below were checked against source and the dogfood host on 2026-07-10.

### 1.1 memex-core today

| Fact | Evidence |
|------|----------|
| Core is path-agnostic | `MemexPaths` is a consumer-supplied descriptor (`src/types.ts`); core never hardcodes home paths (`README.md` ScanDirs / MemexPaths) |
| Sync is **copy** harness → repo (mtime), not symlink | `syncDirectory` / `syncSkillsDirectory` in `src/sync.ts` read + write file bytes |
| Sync layout under `syncRepoDir` | `rules/*.md`, `skills/<name>/SKILL.md`, `projects/<id>/memory/*.md` via `getSyncScanDirs` + `getSyncProjectMemoryDir` |
| `SyncConfig` fields | `enabled`, `repo`, `autoPull`, `autoCommitPush`, `projectMappings`, optional `caseSensitive` (`src/types.ts`) |
| No `SyncProfile`, no origin helpers, no symlink projector | `src/index.ts` exports; grep — absent |
| Per-file lock only | `withFileLock` (`src/file-lock.ts`) — not a tree/repo lock (centroid design already notes #15) |
| Lifecycle centroid is **design**, not code | `design/knowledge-lifecycle-centroid.md`; no `src/lifecycle.ts` yet |

### 1.2 Adapter path defaults (verified in adapter trees)

| Adapter | `syncRepoDir` default | Global rules | Config path |
|---------|----------------------|--------------|-------------|
| **memex-claude** | `~/.local/share/memex-claude` | `~/.claude/rules` | `~/.claude/memex.json` |
| **memex-grok** | `~/.local/share/memex` | `~/.grok/rules` | `~/.grok/memex.json` |

Sources: `memex-claude/src/core/paths.ts`, `memex-grok/src/core/paths.ts`.

Grok doctor explicitly **defers** to the claude corpus when `~/.local/share/memex` is missing and `~/.local/share/memex-claude` exists (`memex-grok/src/cli/doctor.ts` `LEGACY_SYNC_REPO` + `checkSyncRepo`).

### 1.3 Dogfood host (this machine, 2026-07-10)

| Path | State |
|------|--------|
| `~/.memex` | **absent** |
| `~/.local/share/memex` | **absent** |
| `~/.local/share/memex-claude` | **live corpus** — git remote `git@github.com:jim80net/claude-skill-router-corpus`, marker `.memex-sync/version.json` `{ "version": 2 }`, subtrees `rules/`, `skills/` (~47 skill dirs), `projects/` |
| `~/.claude/rules` | **real files** (not symlinks) — ~34 rules; parallel *content* also exists under corpus `rules/` (copy-sync model, not link) |
| `~/.claude/memex.json` | present; `sync.enabled: true`, `repo: git@github.com:jim80net/claude-skill-router-corpus` |
| `~/.grok/rules` | **absent** |
| `~/.grok/memex.json` | **absent** |

**Implication:** the only shared corpus on disk is the **claude-branded** path. Grok’s intended XDG path never became the live origin. A greenfield `~/.memex` matches the product brief and does not collide with an existing directory *on this host*; migration still must respect other hosts that may have either path.

### 1.4 What “sync profile set” is *not* today

There is no first-class profile object. Closest existing knobs:

- Harness `memex.json` → `sync.enabled` + `sync.repo` (claude live; grok defaults `enabled: false`)
- Grok-only `sync.repoDir` override on `GrokSyncConfig` (`memex-grok/src/core/config.ts`)
- Env `MEMEX_CONFIG` (grok) to point at a config file path

---

## 2. Goals (core slice = G0 from brief)

| ID | Goal | Core owns? |
|----|------|------------|
| **G0a** | Canonical shared **origin root** + layout helpers | **Yes** |
| **G0b** | Harness-neutral **sync profile** schema + load/resolve | **Yes** |
| **G0c** | **Materialize** rule/skill/memory into origin (write; optional commit if git-backed) | **Yes** |
| **G0d** | **Symlink projection policy** (pure FS: plan + apply + conflict detection) | **Yes** (golden tests, no harness knowledge) |
| **G1** | Init `~/.grok/rules` / project `.grok/rules` + call core projector | **No** — memex-grok |
| **G2** | MCP memory remains tool-call first-class | **No** — memex-grok (core already indexes; no inject path here) |
| **G3** | Other adapters align | **Later** — each adapter XO |

---

## 3. Non-goals (explicit)

1. **Inject-first** product framing for Grok (or any harness) — out. File rules + (for Grok) MCP tools are the load-bearing surfaces.
2. **Skill/rule refinement feedback loops** — operator deferred. Leave seams on materialize/review APIs; do **not** invent promote/demote product here (centroid design remains the home for that chapter).
3. **Audience dump / constitution ingest** before `memex-hermes#20` — do **not** push private standing doctrine into a shareable remote origin until the operator decides audience. Origin **may start host-local private** (no remote, or private remote only).
4. **Implementing grok/claude/codex/hermes/openclaw projection paths** in this repo — adapters own those.
5. **Mass-migrating seat names** (`codex-memex-dev` → `memex-codex`) — not blocking.
6. **Replacing MCP with filesystem-only memory for Grok**.
7. **Changing copy-sync (`syncCommitAndPush`) semantics in this chapter** — projection is a *new* path; copy-sync remains for hosts that still use it until adapters cut over. Coexistence is specified; big-bang delete is not.

---

## 4. Conceptual model

```
                    ┌─────────────────────────────────────┐
                    │  SHARED ORIGIN  (~/.memex by default)│
                    │  rules/  skills/  projects/…         │
                    │  (optional git remote = SyncConfig)  │
                    └──────────────┬──────────────────────┘
                                   │ materialize* (core)
                                   │ projectSymlinks (core policy)
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ~/.claude/rules/*    ~/.grok/rules/*      <cwd>/.grok/rules/*
     (symlink→origin)     (symlink→origin)     (symlink→origin)
              │                    │
              │  Claude inject     │  Grok: files on disk + MCP
              │  still adapter     │  search/read (no inject reliance)
```

**Provenance invariant:** after a successful project step, `readlink(harnessPath)` resolves under the origin root (or is a relative link into it). Copy-only without an origin pointer is **not** a success path for profile-driven projection.

**Lifecycle ownership:** create/update/retire of corpus entries = Memex (core APIs + adapter judgment wrappers later). Harness dirs are **projections**, not second masters — except conflicted pre-existing real files, which we refuse to clobber (see §7).

---

## 5. Canonical origin root

### 5.1 Recommendation

| Choice | Path | Verdict |
|--------|------|---------|
| **A (recommended)** | `~/.memex` | **Default origin root** |
| B | `~/.local/share/memex` | Keep as **recognized legacy/XDG alias** in resolver only |
| C | `~/.local/share/memex-claude` | **Legacy live corpus** — migrate *from*, do not keep as product default |

**Default:** `join(homedir(), ".memex")`.

**Overrides (precedence high → low):**

1. Explicit path in sync profile (`origin.root`)
2. Env `MEMEX_ORIGIN` (absolute path; for tests/CI/desks)
3. If `~/.memex` exists → use it
4. Else if `~/.local/share/memex` exists → use it (grok’s historical default)
5. Else if `~/.local/share/memex-claude` exists → use it (**compat**; doctor/log WARN “legacy origin”)
6. Else create/use `~/.memex` when profile enables origin

### 5.2 Why not make XDG the product default?

- Brief + hierarchy already name `~/.memex` as the example shared origin.
- On dogfood, XDG `memex` is empty/absent; live data is `memex-claude`.
- Product name and path align (`memex` not `memex-claude`).
- Tradeoff: less pure XDG Base Dir; mitigated by env override + resolver recognizing `~/.local/share/memex`.

### 5.3 Origin layout (v1 — compatible with today’s sync repo)

```
<originRoot>/                 # default ~/.memex
  .memex-sync/version.json    # existing marker (v2+) — keep
  rules/                      # *.md rules (fleet/user standing)
  skills/                     # <skillName>/SKILL.md
  projects/
    <canonicalProjectId>/
      memory/                 # *.md
      # future: rules/, skills/ per knowledge-scope-three-tier
  # future (scope design, not required for G0):
  # fleet/  flotillas/<id>/
```

**v1 does not require** the three-tier `fleet/` / `flotillas/` re-layout to ship. Projection + materialize work against **today’s** `rules/`, `skills/`, `projects/` shapes so we do not block on scope redesign. Scope redesign remains additive (`knowledge-scope-three-tier.md`).

### 5.4 Origin vs cache vs harness state

| Concern | Location | Owner |
|---------|----------|--------|
| Corpus content (origin) | `origin.root` | core layout + materialize |
| Embedding cache / sessions / telemetry | harness paths (`MemexPaths.cacheDir`, etc.) | adapters |
| Harness projection dirs | `~/.grok/rules`, `~/.claude/rules`, project `.*/rules` | adapters call core projector |
| Config | see §8 | profile file + harness memex.json |

Core still does **not** hardcode harness homes; it accepts absolute paths from the profile / caller.

---

## 6. Sync profile schema (harness-neutral)

### 6.1 Type sketch (proposed for `src/types.ts` + resolve helper)

```typescript
/** Where origin content lives on this host. */
export type OriginConfig = {
  /** Absolute or `~/…` path. Empty → resolver default chain (§5.1). */
  root?: string;
  /**
   * Optional git remote for the origin tree (same role as SyncConfig.repo today).
   * Empty / omitted → host-local origin only (valid private mode).
   */
  repo?: string;
};

/**
 * One harness projection target. Core is harness-agnostic: it only sees
 * absolute directory paths + which origin subtrees to link.
 */
export type ProjectionTarget = {
  /** Stable id for logs/doctor: "grok-user-rules", "claude-user-rules", … */
  id: string;
  /** Absolute harness directory to ensure + project into (e.g. ~/.grok/rules). */
  targetDir: string;
  /**
   * Origin-relative source directory under origin.root
   * e.g. "rules", "skills", "projects/github.com/jim80net/foo/memory"
   */
  originRelDir: string;
  /**
   * "files" — each *.md (or pattern) becomes a symlink entry
   * "skill-dirs" — each child dir with SKILL.md is linked as a whole directory
   */
  entryKind: "files" | "skill-dirs";
  /** Glob/suffix filter; default "*.md" for files, ignored for skill-dirs. */
  pattern?: string;
  /** When true, create targetDir if missing. Default true. */
  initTargetDir?: boolean;
};

export type SyncProfile = {
  /** Schema version for migrations. */
  version: 1;
  /** Master switch for profile-driven origin + projection. */
  enabled: boolean;
  origin: OriginConfig;
  /**
   * Projection targets. Empty array = origin-only (materialize/sync git)
   * without symlink management — valid for MCP-only consumers.
   */
  projections: ProjectionTarget[];
  /**
   * Conflict policy when target has a non-link real file/dir.
   * v1: only "fail-closed" is supported (recommended default).
   */
  onClobber: "fail-closed";
  /**
   * When true, replace a symlink that already points inside origin.root
   * if the origin entry moved (relink). Never replace a symlink that points
   * outside origin without fail-closed report.
   */
  relinkManaged?: boolean; // default true
  /**
   * Bridge to existing SyncConfig git pull/push behavior.
   * If omitted, profile can still project a local-only origin.
   */
  sync?: Pick<SyncConfig, "autoPull" | "autoCommitPush" | "projectMappings" | "caseSensitive">;
};
```

### 6.2 On-disk profile location (recommendation)

| Location | Role |
|----------|------|
| **`~/.memex/profile.json`** (or `origin.root/profile.json` when root overridden) | **Canonical host profile** — shared across harnesses |
| Harness `memex.json` → optional `syncProfile` partial **or** `syncProfilePath` | Adapter may point at the host profile or embed a thin override |
| Env `MEMEX_SYNC_PROFILE` | Absolute path override (tests/CI) |

**“Sync profile set” means:** after resolve, `profile.enabled === true` **and** (`origin.root` resolved successfully).  
Not: flotilla desk binding. Flotilla topology must not be the product config plane (desks come and go; origin is host-operator state).

### 6.3 Relationship to existing `SyncConfig`

| Existing field | Fate under profile |
|----------------|--------------------|
| `sync.enabled` | Maps to profile `enabled` *or* remains adapter-local gate that must be true for auto pull/push |
| `sync.repo` | Maps to `origin.repo` |
| `sync.repoDir` (grok extension) | Maps to `origin.root` |
| `projectMappings` / `caseSensitive` | Nested under `profile.sync` or continue on harness config; core `resolveProjectId` unchanged |
| `autoPull` / `autoCommitPush` | Same |

**Migration:** adapters may construct a `SyncProfile` from legacy `SyncConfig` + path defaults in one helper: `profileFromLegacySync(sync, paths): SyncProfile`. No silent dual sources of truth after cutover — prefer profile file once present.

---

## 7. Symlink projection policy (core FS primitive)

### 7.1 Granularity — recommendation

| Option | Pros | Cons | Verdict |
|--------|------|------|---------|
| **Per-entry links** (file for rules/memories; skill dir for skills) | Coexist with local-only harness files; fine-grained fail-closed; matches today’s multi-root scan | More links; skill is a directory link | **Recommend** |
| Whole-dir link of `rules/` | Simple | Cannot mix local-only rules; one conflict blocks whole tree; harder partial migrate | Reject for v1 |

**Per-entry rules:**

- `entryKind: "files"`: for each `originRelDir/<name>.md`, ensure `targetDir/<name>.md` → symlink to origin file (absolute link in v1 for unambiguous `readlink`; relative optional later).
- `entryKind: "skill-dirs"`: for each `originRelDir/<skill>/SKILL.md` present, ensure `targetDir/<skill>` → symlink to origin skill directory.

### 7.2 Fail-closed clobber policy (normative)

For each desired link path `T` → origin `O`:

| Pre-existing `T` | Action |
|------------------|--------|
| Missing | Create parent dirs as needed; `symlink(O, T)` |
| Symlink whose resolve is exactly `O` (or same inode after `realpath`) | No-op (ok) |
| Symlink into `origin.root` but different entry, and `relinkManaged` | Replace symlink |
| Symlink pointing **outside** origin | **Conflict** — do not replace; record error |
| Regular file or directory (non-link) | **Conflict** — do not replace; record error |
| Broken symlink | Treat as replaceable only if `relinkManaged` **and** previous target was under origin *or* profile explicitly allows repair; default **Conflict** if target string not under origin |

**Never** copy origin → harness as a substitute for linking when profile projection is enabled.  
**Never** delete a conflicting real file.

### 7.3 API sketch (core)

```typescript
export type ProjectConflict = {
  targetPath: string;
  originPath: string;
  reason: "real-file" | "real-dir" | "foreign-symlink" | "broken-unmanaged" | "type-mismatch";
};

export type ProjectPlan = {
  ensureDirs: string[];
  links: { targetPath: string; originPath: string; action: "create" | "relink" | "noop" }[];
  conflicts: ProjectConflict[];
};

export function planProjection(
  originRoot: string,
  targets: ProjectionTarget[],
  opts: { relinkManaged: boolean },
): Promise<ProjectPlan>;

/**
 * Apply plan. If any conflicts and onClobber === "fail-closed",
 * apply zero destructive changes (either all-or-nothing for non-conflict
 * entries is OK; conflicts never applied). Return report.
 */
export function applyProjection(
  plan: ProjectPlan,
  opts: { onClobber: "fail-closed" },
): Promise<{ linked: number; skipped: number; conflicts: ProjectConflict[] }>;
```

Golden tests (tmp dirs only): create/noop/relink/conflict matrix; prove real files survive; prove `readlink` points under origin.

### 7.4 User vs project harness dirs

**Both** are first-class; the profile **selects** which projection targets are enabled.

| Scope | Typical targetDir (adapter fills) | Typical originRelDir |
|-------|-----------------------------------|----------------------|
| User rules | `~/.grok/rules`, `~/.claude/rules` | `rules` |
| User skills | `~/.grok/skills`, `~/.claude/skills` | `skills` |
| Project rules | `<cwd>/.grok/rules` | `projects/<id>/rules` (when scope layout lands) **or** omit until layout exists |
| Project memory | (usually not symlinked into harness; MCP/index scans origin) | `projects/<id>/memory` |

**v1 recommendation for Grok (adapter design):**

- Always project **user** rules/skills when profile enabled.
- Project **project** rules only when `projects/<id>/rules` exists (or after three-tier layout); do not invent empty project rule trees.
- Project memory stays **in origin** for Grok MCP scan — no requirement to symlink memories into `.grok/` for v1.

---

## 8. Answers to brief §6 open questions

### Q1 — Origin default: `~/.memex` vs `~/.local/share/memex`?

**Recommendation: `~/.memex` as product default**, with resolver fallbacks (§5.1).

| Tradeoff | Notes |
|----------|--------|
| Branding / brief alignment | Matches hierarchy example and operator steer language |
| Dogfood truth | Neither path is live; live is `memex-claude` — both greenfield options need migration |
| XDG purity | Weaker; accept env `MEMEX_ORIGIN` / profile override for purists |
| Grok code today | Defaults to XDG `memex`; adapter changes when implementing G1 |

### Q2 — Symlink granularity: whole `rules/` vs per-file?

**Recommendation: per-entry** (files for rules/memories; directory links for skills) — §7.1.

| Tradeoff | Notes |
|----------|--------|
| Coexistence | Local-only harness files survive next to projected ones |
| Fail-closed | Conflicts are entry-scoped, not tree-wide |
| Complexity | Slightly more code; fully unit-testable in core |

### Q3 — Project-scoped vs user rules — both? profile selects?

**Recommendation: both supported; profile lists targets; v1 adapters enable user always, project when origin subtree exists.**

| Tradeoff | Notes |
|----------|--------|
| Completeness | Matches how adapters already *scan* both user + project dirs |
| Empty init | Do not create project origin trees just to have links |
| Scope design | Project `rules/` under `projects/<id>/` is forward-compat with three-tier layout |

### Q4 — Interaction with `~/.local/share/memex-claude`?

**Recommendation: migrate-toward-origin, dual-read only during resolver transition — never dual-write two corpuses.**

Phased:

1. **Resolver dual-read** (immediate): prefer `~/.memex`, else XDG `memex`, else `memex-claude` (WARN).
2. **One-shot migrate** (CLI in adapter or thin core helper): move/rename corpus → `~/.memex` (git dir intact), optional backward-compat symlink `memex-claude` → `~/.memex` so old claude builds keep working until adapters bump paths.
3. **No permanent dual-master:** after migrate, all materialize + sync git ops use origin root only.

Do **not** symlink origin → legacy as the long-term model (wrong direction of canonicity).

### Q5 — Does “sync profile set” mean memex.json field, env, or flotilla desk binding?

**Recommendation: host profile file (`~/.memex/profile.json`) is canonical; harness memex.json may enable + path-reference it; env overrides path; flotilla desk binding is out of band.**

| Source | Role |
|--------|------|
| `~/.memex/profile.json` | Canonical |
| `memex.json` `syncProfile` / `syncProfilePath` | Adapter discovery |
| `MEMEX_SYNC_PROFILE` / `MEMEX_ORIGIN` | Test/CI/desk overrides |
| Flotilla desk binding | **Not** the product config plane |

“Set” = resolved `enabled: true` + resolvable origin root.

---

## 9. Lifecycle ops (core) — materialize into origin

Aligns with centroid design’s *mechanism* half; **does not** implement judgment or refinement loops.

### 9.1 Proposed functions (`src/origin.ts` or `src/lifecycle.ts` — name at impl)

```typescript
export type MaterializeKind = "rule" | "skill" | "memory";

export type MaterializeInput = {
  kind: MaterializeKind;
  /** Origin-relative destination, e.g. "rules/my-rule.md" or "skills/foo/SKILL.md" */
  originRelPath: string;
  /** Full markdown body including frontmatter (caller-owned format for v1). */
  content: string;
  /** If true, refuse overwrite when destination exists and content differs. */
  failIfChanged?: boolean;
};

export type MaterializeResult =
  | { status: "created" | "updated" | "unchanged"; absPath: string }
  | { status: "conflict"; absPath: string; reason: string };

/** Write one entry under origin.root with per-file lock. Does not commit. */
export function materializeEntry(
  originRoot: string,
  input: MaterializeInput,
): Promise<MaterializeResult>;

/**
 * Optional git commit of specific paths when origin is a git repo.
 * Reuses git-helpers; does not push unless caller also invokes push.
 */
export function commitOriginPaths(
  originRoot: string,
  relPaths: string[],
  message: string,
): Promise<"committed" | "no-changes" | "not-a-repo" | `failed: ${string}`>;
```

### 9.2 Seams left open (do not invent)

- `reviewLifecycle` / promote-demote plan (centroid) — later
- Constitution carve + `ingestAllStanding` audience filter — **blocked on #20**
- Tree-level repo lock (#15) — prerequisite note for concurrent writers; v1 materialize uses existing per-file lock only and documents the race
- Trust tier frontmatter (`trust` / `provenance`) — centroid; materialize accepts opaque content in v1

### 9.3 Interaction with `syncCommitAndPush`

| Path | Direction | Role after this chapter |
|------|-----------|-------------------------|
| **materialize + commitOriginPaths** | app → origin | Preferred write path for lifecycle |
| **projectSymlinks** | origin → harness | Preferred read path for file-shaped rules |
| **syncCommitAndPush** | harness → origin (copy) | Legacy; still valid until adapters stop treating harness as master |

Adapters that still copy-sync must not fight the projector (copying over a symlink target would write through the link into origin — often desirable — but copying a *new* harness-only file then projecting can create surprises). Document: **once a path is origin-managed, edits should go through materialize or through the symlink (write-through), not via a second unlinked file.**

---

## 10. Security & privacy

1. **Host-local private origin is valid** (`origin.repo` empty). Default recommendation until #20 audience decision: do not assume public/shareable remote for new installs that would ingest constitution.
2. **Do not** auto-ingest `CLAUDE.md` / private rules into origin as part of this chapter.
3. Projection must not follow symlinks out of origin when planning (`realpath` containment under `origin.root`) — same spirit as portable-location containment.
4. `MEMEX_ORIGIN` / profile paths: reject relative paths that escape after resolve; require absolute post-expansion.

---

## 11. Implementation sketch (post-gate only)

Suggested PR sequence **after** design gate (for later; not this PR):

1. **memex-core:** types + `resolveOriginRoot` + `planProjection`/`applyProjection` + `materializeEntry` + tests; export from `index.ts`; openspec deltas for `sync` / new `origin` capability; minor version.
2. **memex-grok:** profile load, `memex init`/`sync` calling core projector into `~/.grok/rules` (+ project), doctor checks (origin present, rules are links, conflicts WARN/FAIL), dogfood.
3. **Freeze-SHA** from flotilla XO when core contract publishes.
4. **Other adapters:** alignment tickets; claude migrates off copy-only harness master gradually.

No code in the design PR beyond this document.

---

## 12. Acceptance (design chapter — for gate)

Design is gate-ready when reviewers can answer:

- [x] Default origin path chosen with tradeoffs and resolver chain
- [x] SyncProfile schema sketched, harness-neutral
- [x] Materialize + symlink policy fail-closed on clobber
- [x] Brief §6 questions answered with recommendations
- [x] Non-goals explicit (inject-first, refinement product, #20 dump)
- [x] Claims grounded in verified paths/code
- [ ] Flotilla XO / systems-review bar (external gate)
- [ ] memex-grok addendum maps G1 onto these primitives (parallel seat)

Impl acceptance remains as brief §7 (core tests, grok dogfood `readlink`, MCP regression) — **after** design gate.

---

## 13. Open questions still for the gate (narrow)

These are the residual forks worth a flotilla XO / operator nod; everything else above has a recommended default:

1. **Default origin `~/.memex` vs force XDG** — this design recommends `~/.memex`. Confirm.
2. **Absolute vs relative symlinks** — this design recommends absolute for v1 inspectability. Confirm or prefer relative for relocatable home.
3. **All-or-nothing apply on conflict** — recommend: apply non-conflicting links, return conflicts for the rest (partial success + non-zero report), still fail-closed on each conflicted path. Alternative: abort entire apply if any conflict. Prefer partial + report for dogfood migrate ergonomics.
4. **Backward-compat symlink `memex-claude` → `~/.memex` after migrate** — recommend yes for one release window.

---

## 14. References (verified)

- Brief: `briefs/file-rules-shared-origin-2026-07-10.md`
- Hierarchy product_direction: `state/hierarchy/memex.yaml`
- Core: `src/types.ts` (`MemexPaths`, `SyncConfig`), `src/sync.ts`, `src/config.ts`, `src/file-lock.ts`, `src/project-mapping.ts`
- Adapters: `memex-claude/src/core/paths.ts`, `memex-grok/src/core/paths.ts`, `memex-grok/src/cli/doctor.ts`
- Related designs: `design/knowledge-lifecycle-centroid.md`, `design/knowledge-scope-three-tier.md`
- Tracking: `memex-hermes#20` audience `[awaiting-auth]`; refinement deferred by operator steer

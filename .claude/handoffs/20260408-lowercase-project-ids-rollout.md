# Handoff: lowercase project IDs rollout (memex-core 0.4.0 → memex-claude)

**Date:** 2026-04-08
**Branch (memex-core):** `fix/release-workflow-npm-tarball` (leftover; can be deleted — PR #20 merged)
**Working directory:** `/home/jim/workspace/github.com/jim80net/memex-core`
**Related worktree:** `/home/jim/workspace/github.com/jim80net/memex-claude-lowercase` on `feat/memex-core-0.4.0` (leftover; can be deleted — PR #46 merged)

## Objective

Make memex-core's sync project IDs case-insensitive by default, across all three resolution paths (manual `projectMappings`, git remote URL via `normalizeGitUrl`, and encoded `_local/` cwd fallback). A clone of `git@github.com:Jim80Net/Repo.git` and `git@github.com:jim80net/repo.git` must collapse to the same canonical ID `github.com/jim80net/repo`, and existing mixed-case sync repos must be migrated automatically on first post-upgrade sync without data loss.

Then cut over memex-claude to consume the new memex-core 0.4.0 so downstream users get the behavior.

## Session Summary

This was a long, multi-phase session that followed Jim's standard development flow end-to-end and finished with a dependent consumer upgrade.

**Phase 1 — Design/spec/plan for memex-core (3 systems-review gates passed):**
1. Brainstormed case-insensitive routing with schema versioning
2. Wrote a design doc at `openspec/changes/lowercase-project-ids/design.md`
3. Ran systems-review on the design → found 2 CRITICAL issues (migration-ordering race, case-insensitive FS silent no-op); design revised
4. Restructured into formal openspec change (proposal + 3 spec files + tasks + plan)
5. Ran systems-review on the openspec artifacts → BREAKING labeling, fuzzy scenarios, internal-state assertions; fixed inline
6. Wrote implementation plan at `openspec/changes/lowercase-project-ids/plan.md` (13 tasks, bite-sized TDD)
7. Ran systems-review on the plan → found 9 issues (`git mv -k` silent skip, missing `mkdir -p` on dest parent, missing empty-ancestor cleanup, duplicate section header, mid-file imports, stale doc refs); all fixed

**Phase 2 — Implementation via subagent-driven-development:**
13 tasks executed, fresh subagent per task (sonnet for most, haiku for trivial). Subagents caught 2 real plan bugs: `fs.rm(dir, {recursive: false})` → EISDIR (must use `rmdir`), and `git rm -r srcRelative` at end of merge path → fails because files already removed from index (must use `fs.rm`). Ran systems-review on the final implementation → found 1 MEDIUM (clone-fallback marker written before fetch = false v2 tag) + 4 LOW; fixed.

**Phase 3 — memex-core PR #17 through CI and cubic:**
Opened PR, CI failed on a stale git identity in CI runners. Fixed with `GIT_AUTHOR_*`/`GIT_COMMITTER_*` env vars via `??=`. Cubic found 7 P2 issues (identified by cubic); all fixed. Merged as commit `2c3f6d1`.

**Phase 4 — 0.4.0 release and publish pipeline fix:**
release-please created PR #18 which was merged, tagging v0.4.0. But the publish job failed — Node 22.22.2's bundled npm was missing `promise-retry`, so `npm install -g npm@latest` failed with MODULE_NOT_FOUND before it could self-upgrade.

Opened PR #19 which tried `corepack prepare npm@11.6.0 --activate` — merged, triggered manual publish, failed again with a 404 on `npm publish`. Root cause: corepack prepare stages npm in the cache but does not replace the runtime `npm` in PATH; `npm --version` still printed 10.9.7, which doesn't support OIDC trusted publishing, so publish fell back to token auth and 404'd.

Opened PR #20 which scraps corepack and downloads the npm 11.6.0 tarball directly with sha512 integrity verification against the registry's own `dist.integrity` (cubic security finding, identified by cubic). Merged. Triggered manual publish via `gh workflow run release-please.yml` → **0.4.0 is now live on npm**.

**Phase 5 — memex-claude cutover (PR #46):**
Bumped `@jim80net/memex-core` from `^0.3.1` to `^0.4.0`. No code changes needed — the consumer surface (syncPull, syncCommitAndPush, findMatchingProjectMemoryDirs, SyncConfig type) is fully backward-compatible. Updated USAGE.md with new `caseSensitive` row and a paragraph on the lowercase default + one-shot migration. 27/27 tests pass, typecheck clean. Cubic found 1 P2 issue (colon vs slash notation in the canonical ID example, identified by cubic); fixed. Merged as PR #46.

**Phase 6 — Release-please auto-queued memex-claude v1.8.0:**
PR #47 `chore(main): release 1.8.0` was opened by release-please after #46 merged. **Still awaiting Jim's merge.** When Jim merges it, memex-claude v1.8.0 ships with the memex-core 0.4.0 dep bump.

## Completed Work

### PR #17 — feat(sync): case-insensitive project IDs with one-shot migration

**PR:** https://github.com/jim80net/memex-core/pull/17 (merged as commit `2c3f6d1`)

**Problem:** `normalizeGitUrl` preserved whatever case the git remote URL returned, so clones with different casings (`GitHub.com:Jim80Net/Repo` vs `github.com:jim80net/repo`) collapsed to two distinct canonical IDs and two parallel memory trees in the sync repo.

**Root cause:** `src/project-mapping.ts:18-37` did `result.toLowerCase()`-free normalization. `resolveProjectId` then used whatever case `normalizeGitUrl` returned. Writers wrote to mixed-case paths, which persisted across all devices as long as no one normalized.

**Fix:** Added `SyncConfig.caseSensitive?: boolean` (default `false`). Lowercased all three resolution paths in `resolveProjectId`. Added a case-insensitive probe to `findMatchingProjectMemoryDirs` for the rollout window. Introduced `src/sync-migration.ts` with `runSyncMigrations`, `migrateProjectIdsToLowercase`, `readSyncRepoVersion`, `writeSyncRepoVersion`, `mergeMarkdownBodies`, `isMidRebaseOrMerge`, and `MigrationResult`. Wired `runSyncMigrations` into `syncPull` at exactly two positions (no-remote local-only path, and after a successful rebase/merge — NOT the `!hasCommits` path, to avoid the clone-fallback race). Extracted git subprocess helpers from `sync.ts` into `src/git-helpers.ts`.

**Files changed (16):**
- `src/types.ts` — add `caseSensitive?` field
- `src/project-mapping.ts` — lowercase `normalizeGitUrl` + `resolveProjectId`; case-insensitive fallback in `findMatchingProjectMemoryDirs`
- `src/git-helpers.ts` — new module with `git`, `isGitRepo`, `hasCommits`, `hasRemote`, `getDefaultBranch`
- `src/sync-migration.ts` — new module, ~390 lines
- `src/sync.ts` — import git helpers from `./git-helpers.js`; call `runSyncMigrations` in `syncPull`; extract `pullWithConflictResolution` helper
- `src/index.ts` — export `migrateProjectIdsToLowercase`, `runSyncMigrations`, `readSyncRepoVersion`, `writeSyncRepoVersion`, `MigrationResult`
- `test/project-mapping.test.ts` — new tests for lowercasing and reader fallback
- `test/sync-migration.test.ts` — new file, 27 tests including multi-device race
- `README.md` — `## Sync` section with `caseSensitive` docs
- `CHANGELOG.md` — BREAKING CHANGES + Features sections
- 6 files under `openspec/changes/lowercase-project-ids/` — proposal, design, plan, tasks, and 3 specs

**Tests:** 143/143 pass on Linux (macOS merge-path tests skip on case-insensitive FS)
**Review:** systems-review 3x (design/spec/plan) + cubic (7 P2 findings, all identified by cubic, all resolved)
**Deploy:** auto-released by release-please as v0.4.0 (PR #18)

### PRs #19 and #20 — CI publish workflow fixes

**PR #19** (`cf65d33`): Replaced broken `npm install -g npm@latest` with `corepack prepare npm@11.6.0 --activate` and added `workflow_dispatch` trigger for manual publish recovery. **Did NOT fix the underlying publish failure** because corepack doesn't actually swap npm in PATH on GitHub runners.

**PR #20** (`c5d43be`): Scrapped corepack, downloads npm 11.6.0 tarball directly and extracts over `$NODE_DIR/lib/node_modules/npm`. Adds sha512 integrity verification against the registry's own `dist.integrity` metadata (cubic security finding, identified by cubic). Also uses `!cancelled()` instead of `always()` for the publish gate (cubic finding, identified by cubic).

Manual publish triggered via `gh workflow run release-please.yml` → **v0.4.0 live on npm**.

### PR #46 (memex-claude) — bump @jim80net/memex-core to ^0.4.0

**PR:** https://github.com/jim80net/memex-claude/pull/46 (merged)

**Changes:**
- `package.json`: `^0.3.1` → `^0.4.0`
- `pnpm-lock.yaml`: regenerated
- `USAGE.md`: added `caseSensitive` row to sync config table; added paragraph in "Project identity" section documenting lowercase default + one-shot migration
- Cubic finding fixed: colon→slash notation in canonical ID example

**Tests:** 27/27 pass, typecheck clean
**Consumer surface impact:** None. memex-claude uses `syncPull`, `syncCommitAndPush`, `findMatchingProjectMemoryDirs`, and the `SyncConfig` type — all fully backward-compatible.

### Key Decisions

| Decision | Rationale | Alternatives Rejected |
|----------|-----------|----------------------|
| Schema marker at `.memex-sync/version.json` | Matches existing `version: N` pattern in `CacheData`, `ProjectRegistry`, `TelemetryData` | In-repo marker file at root (would clutter); commit-message marker (fragile) |
| Two-step `git mv src src.tmp; git mv src.tmp dst` always | Safe on both case-insensitive (macOS/Windows) and case-sensitive (Linux) filesystems | Direct `git mv` (fails on case-insensitive); `git mv -k` (silently skips errors) |
| Markdown merge = concatenate bodies with `\n\n` | Lossless; dedupes identical content; reuses the `autoResolveMarkdownConflict` philosophy | Last-write-wins (loses content); user-prompted (can't run unattended) |
| Migration runs only inside `syncPull` | Never against stale pre-fetch state; cross-device coordination via v2 marker | In `initSyncRepo` (race); in `syncCommitAndPush` (breaks consumer contract) |
| Migration skipped on `!hasCommits` path | Clone-fallback path would write marker before fetch → falsely tag unmigrated remote content as v2 | Write marker anyway (introduces the exact race the fix prevents) |
| Install npm via direct tarball with sha512 integrity verification | Node 22.22.2's bundled npm is broken; corepack doesn't swap PATH; npm@latest self-loops | corepack prepare (doesn't activate); downgrade Node (unclear which patch works) |
| `!cancelled()` instead of `always()` for publish gate | Respects manual workflow cancellation while still running when release-please is skipped on `workflow_dispatch` | `always()` (publishes even on cancel — security issue, caught by cubic) |

## Current State

### Git — memex-core

```
Branch: fix/release-workflow-npm-tarball  (leftover; safe to delete)
36d975f ci: verify npm tarball integrity before extract
efaf190 ci: install npm via direct tarball, not corepack
68bd2e6 docs: add GitNexus code intelligence config (#4)
cf65d33 ci: fix broken npm upgrade blocking v0.4.0 publish (#19)
dc07e20 chore(main): release memex-core 0.4.0 (#18)
2c3f6d1 feat(sync): case-insensitive project IDs with one-shot migration (#17)
```

`origin/main` is at `c5d43be` (PR #20 squash merge, which is what published v0.4.0). No open PRs authored by me in memex-core.

```
git status:
?? .claude/          (untracked — this handoff lives here)
?? .opencode/
?? openspec/config.yaml
```

### Git — memex-claude

Working tree at `/home/jim/workspace/github.com/jim80net/memex-claude-lowercase`, branch `feat/memex-core-0.4.0` (leftover; safe to delete — PR #46 merged).

`origin/main` has my merge plus the release-please PR #47 pending.

```
4dbcfab docs: fix canonical id format in USAGE.md caseSensitive row
a6148ee feat: bump @jim80net/memex-core to ^0.4.0
b48e77e chore(main): release 1.7.0 (#44)
```

### npm registry

```
npm view @jim80net/memex-core versions → [0.1.0, 0.2.2, 0.2.3, 0.3.0, 0.3.1, 0.4.0]
```

**v0.4.0 is live.**

### Open PRs (memex-claude)

```
#47 chore(main): release 1.8.0     ← release-please, awaits Jim's merge
#45 feat: auto-memory interop       ← unrelated, in flight
#39 feat: benchmark harness         ← unrelated, in flight
```

## Remaining Work

### 1. Merge release-please PR #47 for memex-claude v1.8.0 [HIGH]

**What:** Jim clicks merge on https://github.com/jim80net/memex-claude/pull/47 (`chore(main): release 1.8.0`). This tags v1.8.0 and triggers the memex-claude release-please publish job.

**Why:** Without this, the memex-core 0.4.0 dep bump exists on main but hasn't been released to downstream users of the memex-claude plugin. The whole point of Phase 5 is blocked until this ships.

**Blocked by:** Nothing — PR is open, CI is presumably passing.

**Verify:** Check that memex-claude v1.8.0 shows up in the plugin's release page and that `~/.claude/plugins/cache/jim80net-plugins/memex-claude/1.8.0/` exists after the next plugin sync.

**Pitfall:** The memex-claude release-please workflow may have the **same** broken `npm install -g npm@latest` issue that memex-core had. Check `.github/workflows/release-please.yml` in memex-claude — if it does, the fix is the same tarball+integrity pattern applied in memex-core PR #20. Template: `/home/jim/workspace/github.com/jim80net/memex-core/.github/workflows/release-please.yml` on main.

### 2. Clean up leftover worktrees and branches [LOW]

**What:**
```bash
# memex-core
git -C ~/workspace/github.com/jim80net/memex-core branch -D fix/release-workflow-npm-tarball
git -C ~/workspace/github.com/jim80net/memex-core branch -D feat/lowercase-project-ids  # if still present
git -C ~/workspace/github.com/jim80net/memex-core checkout main
git -C ~/workspace/github.com/jim80net/memex-core fetch origin main
git -C ~/workspace/github.com/jim80net/memex-core reset --keep origin/main

# memex-claude worktree cleanup
git -C ~/workspace/github.com/jim80net/memex-claude worktree remove ../memex-claude-lowercase
```

**Why:** Keep the workspace clean. None of these branches have any unpushed commits.

**Verify:** `git worktree list` shows only the primary worktree for each repo; `git branch` shows only `main` and `feat/benchmark-harness` in memex-claude.

### 3. Archive the openspec change [LOW]

**What:**
```bash
cd ~/workspace/github.com/jim80net/memex-core
openspec archive lowercase-project-ids
```

This should roll the change's spec deltas into the main `openspec/specs/` directory as the new baseline, then move the change to `openspec/changes/archive/`.

**Why:** openspec tracks completed changes by archiving them. Leaving them in `openspec/changes/` makes the next `openspec list` output noisy and can confuse future `openspec status` commands.

**Pitfall:** openspec may complain about the existing `openspec/config.yaml` being untracked or similar. Resolve by committing it first.

## Failed Approaches & Dead Ends

### `corepack prepare npm@11.6.0 --activate` in CI

**Error/Problem:** The step printed "Preparing npm@11.6.0 for immediate activation..." but `npm --version` in the next shell step still printed `10.9.7`. Subsequent `npm publish` 404'd because the still-bundled npm 10.x doesn't support OIDC trusted publishing.

**Root cause:** Corepack prepares the package manager in `~/.cache/node/corepack/...` and sets up shims, but on GitHub Actions runners the bundled `npm` in `/opt/hostedtoolcache/node/.../bin/` takes precedence in PATH. Corepack's shims don't override it the same way they do for pnpm/yarn.

**Lesson:** Don't rely on corepack for npm. Use a direct tarball download + extract, or pin Node to a patch version with a working bundled npm (if you can find one).

### `git rm -r srcRelative` at end of merge path

**Error/Problem:** After `mergeProjectDirs` walks `src/memory/` and removes all files via individual `git mv`/`git rm` calls, the final `git rm -r srcRelative` failed: "fatal: pathspec 'projects/Foo' did not match any files". The files were already removed from the index.

**Root cause:** `git rm` only operates on tracked files. Once all files are removed, git has nothing to "rm -r", even though the empty directory still exists on disk.

**Lesson:** For the final cleanup of an empty legacy directory tree after all file-level git operations, use `fs.rm(path, {recursive: true, force: true})` — the same pattern `removeEmptyLegacyAncestors` uses.

### `fs.rm(path, {recursive: false})` on an empty directory

**Error/Problem:** `ENOTEMPTY` / `EISDIR` on Linux. The plan originally called this inside `removeEmptyLegacyAncestors`.

**Root cause:** In `node:fs/promises`, `rm(path, {recursive: false})` does `unlink()`-like semantics — only works on files. Even an empty directory throws.

**Lesson:** Use `rmdir(path)` for empty-only removal. It naturally throws `ENOTEMPTY` if the directory isn't empty, which is the behavior you want for "walk up removing empty ancestors until you hit something non-empty."

### `npm install -g npm@latest` on Node 22.22.2

**Error/Problem:** `npm error code MODULE_NOT_FOUND / npm error Cannot find module 'promise-retry' / Require stack: .../npm/node_modules/@npmcli/arborist/lib/arborist/rebuild.js`

**Root cause:** Node 22.22.2's bundled npm shipped without the `promise-retry` dependency. When you run `npm install -g`, the current (broken) npm tries to execute itself to install its replacement — but the broken npm can't load, so it crashes before doing anything.

**Lesson:** Don't rely on `npm install -g npm@X` when the currently-installed npm might be broken. Sidestep via direct tarball download.

## Gotchas & Environment Notes

- **pnpm wrapper at `~/.local/share/pnpm/pnpm` is broken in WSL.** Returns "This: not found". Use `corepack pnpm` or the `node_modules/.bin/vitest` / `node_modules/.bin/tsc` binaries directly. The brokenness surfaced repeatedly in both memex-core and memex-claude during this session.

- **Protected main branches block direct push.** In both memex-core and memex-claude, pushing to `main` is denied by a `PreToolUse:Bash` hook. Create a feature branch and open a PR even for trivial CI fixes. Jim merges all PRs.

- **Auto-merge is blocked.** A hook blocks `gh pr merge` invocations unconditionally. Every PR requires Jim to merge manually. Don't attempt the same command twice expecting a different result, and don't try to work around the hook.

- **openspec change names must start with a letter.** Date-prefixed names like `2026-04-07-foo` fail `openspec status` validation even though `openspec list` displays them. Saved as a skill at `~/.claude/skills/openspec-change-naming/SKILL.md`.

- **Cubic's review comments carry authorship.** When citing cubic's findings, use "identified by cubic" in commit messages to attribute them. Cubic's attribution footer explicitly requests this.

- **Cubic review comments on old commits appear to re-anchor to new commits.** After pushing a fix, old comments that were on lines now containing the fix still show up in `gh api .../pulls/<num>/comments` with `commit_id` pointing at the NEW commit. They're stale but GitHub UI shows them as open. Verify by reading the actual fix code.

- **Vitest with real `git` subprocess needs CI git identity.** Set env vars at the top of the test file after imports:
  ```typescript
  process.env.GIT_AUTHOR_NAME ??= "Memex Test";
  process.env.GIT_AUTHOR_EMAIL ??= "test@memex.local";
  process.env.GIT_COMMITTER_NAME ??= "Memex Test";
  process.env.GIT_COMMITTER_EMAIL ??= "test@memex.local";
  ```
  The `??=` operator only sets when undefined, so local runs with a real identity are unaffected.

- **Jim's standard development flow** is now documented at `~/.claude/rules/standard-development-flow.md` — use it for all substantive changes. Brainstorm → design → systems-review (gate 1) → openspec change → systems-review (gate 2) → plan → systems-review (gate 3) → implement → systems-review (gate 4) → PR → cubic → CI → merge. Three systems-review gates are non-negotiable.

- **Saved this session's learnings as skills:**
  - `~/.claude/rules/never-auto-merge-prs.md`
  - `~/.claude/skills/ci-publish-workflow-gotchas/SKILL.md`
  - `~/.claude/skills/git-mv-case-only-rename/SKILL.md`
  - `~/.claude/skills/node-fs-rm-empty-directory/SKILL.md`
  - `~/.claude/skills/openspec-change-naming/SKILL.md`

## To Resume

1. Check if PR #47 is still open or has been merged:
   ```bash
   gh -R jim80net/memex-claude pr view 47 --json state,mergeable,statusCheckRollup | python3 -m json.tool
   ```

2. If PR #47 is open and green, remind Jim to merge it (you cannot auto-merge — hook-enforced rule).

3. If PR #47 is merged, verify the memex-claude v1.8.0 release went out:
   ```bash
   # From any dir outside the memex-claude worktree (avoid the pnpm packageManager block):
   (cd /tmp && corepack npm view memex-claude version 2>&1 | tail -5)
   # Or check the plugin cache:
   ls ~/.claude/plugins/cache/jim80net-plugins/memex-claude/
   ```

4. If the publish failed with the same npm bug, apply the tarball+integrity fix from `memex-core/.github/workflows/release-please.yml` to the memex-claude workflow.

5. Optionally clean up (Remaining Work item 2) and archive the openspec change (item 3).

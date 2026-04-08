# Lowercase project IDs with case-insensitive-by-default sync

**Status:** proposed
**Date:** 2026-04-07
**Scope:** `src/project-mapping.ts`, `src/sync.ts`, `src/types.ts`, `src/index.ts`; new files `src/sync-migration.ts`, `src/git-helpers.ts`

## Problem

`normalizeGitUrl` in `src/project-mapping.ts:18` preserves whatever case the git remote returns. A user who clones `git@github.com:Jim80Net/Repo.git` on one machine and `git@github.com:jim80net/repo.git` on another ends up with two different canonical project IDs (`github.com/Jim80Net/Repo` vs `github.com/jim80net/repo`) and two parallel memory trees in the sync repo. Case-insensitive routing is the correct default — but existing users already have mixed-case directories that must be migrated safely.

## Goals

1. Project IDs are lowercase by default across all three resolution paths (manual mappings, git remote, encoded `_local/` fallback).
2. A `caseSensitive: true` opt-out preserves the current behavior for users who want it.
3. Existing sync repos with mixed-case directories are migrated once, automatically, with no data loss.
4. Migration is safe across devices, case-insensitive filesystems (macOS APFS, Windows NTFS), and concurrent sync operations.

## Non-goals

- Changing case handling for rules, skills, or any content **inside** project memory files.
- Versioning the telemetry, cache, or registry schemas.
- Migrating `_local/` encoded paths that differ only by case on Linux (user sets `caseSensitive: true` if they need this).

## Design

### 1. Schema evolution

**Type change** in `src/types.ts`:

```typescript
export type SyncConfig = {
  enabled: boolean;
  repo: string;
  autoPull: boolean;
  autoCommitPush: boolean;
  projectMappings: Record<string, string>;
  caseSensitive?: boolean; // default false → lowercase all project IDs
};
```

`caseSensitive` is optional. `undefined` means `false`. Old configs keep working with the new default behavior.

**On-disk marker** at `<syncRepoDir>/.memex-sync/version.json`:

```json
{ "version": 2 }
```

Version 1 is implicit (marker missing, case-preserving legacy). Version 2 means "project IDs have been normalized to lowercase in this sync repo". Follows the existing `version: N` pattern (`CacheData.version: 2`, `ProjectRegistry.version: 1`).

### 2. Writer path — `resolveProjectId` lowercases by default

`normalizeGitUrl` gains an optional `caseSensitive` parameter (default `false`):

```typescript
export function normalizeGitUrl(url: string, caseSensitive = false): string {
  // ...existing normalization logic unchanged...
  return caseSensitive ? result : result.toLowerCase();
}
```

`resolveProjectId` applies the flag symmetrically to all three resolution paths:

```typescript
export async function resolveProjectId(cwd: string, syncConfig: SyncConfig): Promise<string> {
  const preserveCase = syncConfig.caseSensitive === true;
  const norm = (s: string) => (preserveCase ? s : s.toLowerCase());

  if (syncConfig.projectMappings[cwd]) {
    return norm(syncConfig.projectMappings[cwd]);
  }

  const remoteUrl = await getGitRemoteUrl(cwd);
  if (remoteUrl) {
    return normalizeGitUrl(remoteUrl, preserveCase);
  }

  return `_local/${norm(encodeProjectPath(cwd))}`;
}
```

No marker check on the writer path. The flag alone determines the new writes. The marker only gates the **one-time scan of legacy data**.

### 3. Migration — `src/sync-migration.ts`

New file containing three exported functions and internal helpers.

#### `readSyncRepoVersion(syncRepoDir): Promise<number>`

Reads `.memex-sync/version.json`. Returns `1` if the file is missing, unreadable, or malformed (legacy default).

#### `writeSyncRepoVersion(syncRepoDir, version): Promise<void>`

Creates `.memex-sync/` if needed, writes `{ version }` as pretty-printed JSON with a trailing newline.

#### `migrateProjectIdsToLowercase(syncRepoDir): Promise<{ renamed: string[]; merged: string[] }>`

Pure scan + rename operation. Does not commit. Does not check the marker. Callers own those decisions.

**Algorithm:**

1. Walk `projects/` recursively. Collect every directory that is an **immediate parent** of a `memory/` subdirectory. That relative path (e.g., `github.com/Jim80Net/Repo`) is a project ID.
2. For each project ID containing any uppercase letter, compute the lowercase form.
3. Sort by depth descending (rename deepest paths first to avoid clobbering parents).
4. For each `(src, dst)` pair:
   - **Case-only rename** (`src.toLowerCase() === dst.toLowerCase() && src !== dst`):
     - **Always** use the two-step pattern, regardless of filesystem:
       ```
       git mv -k <projects/src> <projects/src>.memex-rename-tmp
       git mv -k <projects/src>.memex-rename-tmp <projects/dst>
       ```
     - This is the canonical git recipe for case-only renames on case-insensitive filesystems (macOS APFS, Windows NTFS), and it's safe on case-sensitive ones too.
     - Record in `renamed`.
   - **True merge** (`dst` already exists as a distinct path — only possible on case-sensitive FS):
     - Walk `projects/src/memory/` file-by-file:
       - If the file is absent in `projects/dst/memory/`: `git mv` it over.
       - If present and both are `.md`: read both bodies, apply `mergeMarkdownBodies` (below), write to dst, `git rm` src.
       - If present and not `.md`: compare `mtimeMs`. Copy newer to dst (if src newer) or leave dst alone (if dst newer). `git rm` the src.
     - After the walk: `git rm -r projects/src` (the now-empty source directory).
     - Record in `merged`.
5. Return counts.

**Markdown body merge** (not to be confused with `autoResolveMarkdownConflict`, which parses inline conflict markers):

```typescript
function mergeMarkdownBodies(a: string, b: string): string {
  const at = a.trim();
  const bt = b.trim();
  return at === bt ? at : `${at}\n\n${bt}`;
}
```

Lossless concatenation, deduplicated if identical — same philosophy as the existing inline conflict resolver.

#### `runSyncMigrations(config, syncRepoDir): Promise<string>`

Orchestrator called by `sync.ts`. Handles gating, mid-state detection, and commit.

```typescript
export async function runSyncMigrations(
  config: SyncConfig,
  syncRepoDir: string,
): Promise<string> {
  if (config.caseSensitive === true) return "migration skipped (case-sensitive mode)";

  if (await isMidRebaseOrMerge(syncRepoDir)) {
    return "migration skipped (mid-rebase/merge state)";
  }

  if (!(await hasCommits(syncRepoDir))) {
    // Fresh repo — write the marker so the first user commit carries it.
    await writeSyncRepoVersion(syncRepoDir, 2);
    return "marker initialized (fresh repo)";
  }

  const version = await readSyncRepoVersion(syncRepoDir);
  if (version >= 2) return "migration skipped (already v2)";

  const result = await migrateProjectIdsToLowercase(syncRepoDir);
  await writeSyncRepoVersion(syncRepoDir, 2);

  await git(["add", "-A"], syncRepoDir);
  const { stdout } = await git(["status", "--porcelain"], syncRepoDir);
  if (!stdout.trim()) return "migration: no changes";

  await git(
    ["commit", "-m", "memex: migrate project IDs to lowercase (schema v1 → v2)"],
    syncRepoDir,
  );
  process.stderr.write(
    `memex[sync]: migrated ${result.renamed.length} project(s), merged ${result.merged.length}\n`,
  );
  return `migrated ${result.renamed.length} dir(s), merged ${result.merged.length}`;
}
```

`isMidRebaseOrMerge(syncRepoDir)` checks for `.git/rebase-merge/`, `.git/rebase-apply/`, `.git/MERGE_HEAD`. If any exist, migration bails cleanly — a broken tree is not our problem to fix here.

### 4. Runtime ordering — migration only after a successful pull

This is the critical correctness point. Migration must never run against stale local state when a remote exists, otherwise two devices upgrading in parallel will create divergent migration commits and deadlock each other's rebases.

**`syncPull` (revised):**

```
1. initSyncRepo  (no migration here)
2. if !hasRemote:           → runSyncMigrations, return "no remote configured"
3. if !hasCommits:           → runSyncMigrations (writes marker), return "no commits yet"
4. git fetch origin          → on failure, return "fetch failed" (no migration)
5. git rebase origin/main    → with existing conflict resolution
   — or fall through to merge fallback —
6. runSyncMigrations         (on the post-pull tip)
7. return pull status
```

Migration runs at exactly three positions inside `syncPull`, all of them safe:
- **No remote configured** (step 2) — purely local repo, no cross-device coordination is possible, migrate immediately.
- **No commits yet** (step 3) — nothing to migrate, but `runSyncMigrations` writes the marker so the first user commit carries it.
- **After a successful rebase/merge** (step 6) — we are on the latest remote tip, so any other device that already migrated will have pushed a v2 marker that we now see and skip on.

The "fetch failed" early return (step 4) intentionally does **not** run migration: migrating locally without having seen the remote is exactly the divergent-history race the systems review called out.

**`syncCommitAndPush` does NOT run migration.** It continues to assume — as it already does today — that the consumer calls `syncPull` first. `memex-claude`, `memex-openclaw`, and every other consumer already follow this pattern. Running migration here would re-introduce the stale-state race.

This means: if a user upgrades the library and calls `syncCommitAndPush` without ever calling `syncPull`, migration does not happen until their first `syncPull`. The marker stays at v1 locally. Writes still go to lowercase paths (because `resolveProjectId` is lowercased), so the legacy mixed-case dirs simply sit next to new lowercase dirs until the first pull. The reader fallback below handles this rollout window.

### 5. Reader fallback — `findMatchingProjectMemoryDirs`

During the rollout window (before a user's first post-upgrade `syncPull`), legacy mixed-case directories still exist in the sync repo while `resolveProjectId` returns the lowercase canonical ID. `findMatchingProjectMemoryDirs` (currently in `src/project-mapping.ts:83`) would return an empty list for those users — memories appear lost.

Fix: the function gains a case-insensitive probe of `projects/`. After looking up the canonical lowercase ID and the `_local/` encoded fallback, it walks `projects/` one level at a time and collects any path that (a) lowercases to the canonical ID and (b) is not equal to the already-found canonical path.

The walk is bounded by project tree depth (~3 levels: `host/owner/repo`). Cost is one `readdir` per level, negligible on a personal sync repo. No marker-version gating is needed; after migration completes, there are no mixed-case siblings, so the probe is a fast no-op.

The function continues to return a list so callers can merge contents from all matches (existing behavior).

### 6. Exports — `src/index.ts`

```typescript
export { migrateProjectIdsToLowercase, runSyncMigrations } from "./sync-migration.js";
```

`runSyncMigrations` is exported so platform CLIs (`memex doctor`, etc.) can invoke it directly for diagnostics or forced migration.

## Trade-offs and open constraints

- **Linux case-distinct `_local/` paths collapse under the default**: `/home/Jim/work` and `/home/jim/work` both encode to `-home-jim-work` under `caseSensitive: false`. Users who legitimately have case-distinct cwd paths on a case-sensitive filesystem must set `caseSensitive: true`. Documented, not fixed.
- **Manual `projectMappings` values get lowercased at runtime under the default**: the user's stored mapping stays intact as typed in their config file, but the resolved ID is lowercased. The `caseSensitive: true` opt-out preserves case in the resolved ID.
- **Consumers must call `syncPull` before `syncCommitAndPush`** for migration to happen on the upgrade sync. This is already the established pattern; documented more explicitly.
- **Offline upgrade is deferred**: a user who upgrades and runs sync while offline will fall through the "fetch failed" early return. Migration will not run until they are back online and can pull successfully. This is intentional — migrating locally without fetch would create exactly the divergent-history race the CRITICAL finding called out.

## Testing plan

Add `test/sync-migration.test.ts` (uses tmpdir + real `git init` as the sync repo):

1. **Single case-only rename** — create `projects/Foo/Bar/memory/notes.md`, run migration, verify it lives at `projects/foo/bar/memory/notes.md` and `Foo/` is gone.
2. **Two-step rename on simulated case-insensitive FS** — `git config core.ignorecase true`, verify the two-step rename pattern is used and succeeds.
3. **True merge (case-sensitive)** — both `projects/Foo/memory/notes.md` and `projects/foo/memory/notes.md` exist with different bodies; expect merged body `"A\n\nB"` at `projects/foo/memory/notes.md`.
4. **Merge dedupes identical content** — both sides have `"same\n"`, expect one copy.
5. **Non-`.md` file keeps newer mtime** — merge picks newer file.
6. **Fresh repo** — empty repo with no commits, run `runSyncMigrations`, expect marker written and no migration commit.
7. **Idempotent second run** — after v2, subsequent `runSyncMigrations` returns `"migration skipped (already v2)"` and creates no commits.
8. **`caseSensitive: true`** — skips entirely, marker not written.
9. **Mid-rebase state** — manually create `.git/rebase-merge/`, expect `runSyncMigrations` to bail with `"migration skipped (mid-rebase/merge state)"`.
10. **Multi-device race simulation** — two tmpdir clones of a shared bare remote, both running `syncPull` in sequence. First pull migrates and pushes. Second clone's pull sees v2 marker via the fetch, skips migration, ends with the same tree. No divergent history.
11. **`findMatchingProjectMemoryDirs` rollout fallback** — sync repo with mixed-case `projects/Foo/Bar/memory/notes.md` but no v2 marker; call `findMatchingProjectMemoryDirs` with a cwd that resolves to `github.com/foo/bar`; expect the mixed-case path to be returned alongside any canonical match.

Add to `test/project-mapping.test.ts`:

12. `normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git")` → `"github.com/jim80net/repo"`.
13. `normalizeGitUrl(url, true)` preserves case.
14. `resolveProjectId` with mixed-case `projectMappings` value lowercases by default and preserves with `caseSensitive: true`.

## Files touched

| File | Change |
|------|--------|
| `src/types.ts` | Add `caseSensitive?: boolean` to `SyncConfig` |
| `src/project-mapping.ts` | Lowercase in `normalizeGitUrl` + `resolveProjectId`; case-insensitive fallback in `findMatchingProjectMemoryDirs` |
| `src/git-helpers.ts` | **new** — extract `git`, `isGitRepo`, `hasCommits`, `hasRemote`, `getDefaultBranch` from `sync.ts` into an internal module so `sync.ts` and `sync-migration.ts` can share them without circular imports. |
| `src/sync-migration.ts` | **new** — migration algorithm, marker helpers, `runSyncMigrations` orchestrator, `isMidRebaseOrMerge`, `mergeMarkdownBodies` |
| `src/sync.ts` | Call `runSyncMigrations` inside `syncPull` at the three positions above; `initSyncRepo` is unchanged. Imports git helpers from `./git-helpers.js` instead of defining them locally. |
| `src/index.ts` | Export `migrateProjectIdsToLowercase`, `runSyncMigrations` |
| `test/project-mapping.test.ts` | Cases 12–14 |
| `test/sync-migration.test.ts` | **new** — cases 1–11 |

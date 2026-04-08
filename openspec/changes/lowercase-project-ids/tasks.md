> Detailed step-by-step instructions (with full code, test cases, and commit messages) live in [`plan.md`](./plan.md). This file is the high-level checklist that openspec uses to track progress.

## 1. Schema and refactor foundations

- [x] 1.1 Add `caseSensitive?: boolean` to `SyncConfig` in `src/types.ts` (project-mapping spec → "SyncConfig carries an optional caseSensitive flag")
- [x] 1.2 Extract `git`, `isGitRepo`, `hasCommits`, `hasRemote`, `getDefaultBranch` from `src/sync.ts` into new `src/git-helpers.ts`; update `src/sync.ts` to import from `./git-helpers.js` (sync spec → "Git subprocess helpers live in a shared internal module")

## 2. Writer-side lowercase normalization

- [x] 2.1 Update `normalizeGitUrl` in `src/project-mapping.ts` to accept an optional `caseSensitive` parameter (default `false`) and lowercase by default. Add the three new tests to `test/project-mapping.test.ts` first (project-mapping spec → "normalizeGitUrl lowercases by default")
- [x] 2.2 Update `resolveProjectId` in `src/project-mapping.ts` to apply the `caseSensitive` flag symmetrically across manual mappings, git remote URL, and `_local/` encoded fallback. Add the four new tests first (project-mapping spec → "resolveProjectId applies case handling symmetrically across all three resolution paths")

## 3. Reader-side rollout fallback

- [x] 3.1 Update `findMatchingProjectMemoryDirs` in `src/project-mapping.ts` with a case-insensitive probe of `projects/`. Add the two rollout-fallback tests first (project-mapping spec → "findMatchingProjectMemoryDirs probes for legacy mixed-case directories")

## 4. Sync migration module — scaffold and helpers

- [x] 4.1 Create `test/sync-migration.test.ts` with the shared `beforeEach`/`afterEach` git tmpdir setup
- [x] 4.2 Create `src/sync-migration.ts` with `readSyncRepoVersion`, `writeSyncRepoVersion`, `mergeMarkdownBodies`, and `isMidRebaseOrMerge`. Tests for each helper go in first (sync-migration spec → "Sync repo carries a versioned schema marker", "Migration losslessly merges colliding lowercase trees" partial — `mergeMarkdownBodies`)

## 5. Migration algorithm

- [x] 5.1 Implement `migrateProjectIdsToLowercase` (case-only rename path) in `src/sync-migration.ts`: walker, deepest-first sort, two-step `git mv`, destination-parent `mkdir -p`, empty legacy ancestor cleanup. Tests for the four rename scenarios go in first (sync-migration spec → "Migration walks projects/ and renames mixed-case project IDs to lowercase")
- [x] 5.2 Implement the true merge path (`mergeProjectDirs` + the `isDistinctMerge` branch in `migrateProjectIdsToLowercase`). Tests for the four merge scenarios go in first; tests skip on case-insensitive filesystems via the `isCaseSensitive` probe (sync-migration spec → "Migration losslessly merges colliding lowercase trees")

## 6. Migration orchestrator

- [x] 6.1 Implement `runSyncMigrations` in `src/sync-migration.ts`. Tests for the six gating/orchestration scenarios go in first (sync-migration spec → "runSyncMigrations orchestrates gating, commit, and idempotency")

## 7. Wire migration into syncPull

- [x] 7.1 Modify `src/sync.ts` to import `runSyncMigrations` and call it at exactly three positions inside `syncPull`: no-remote local-only path, no-commits fresh-repo path, and after a successful rebase/merge. Extract `pullWithConflictResolution` helper to keep `syncPull` readable. `syncCommitAndPush` is unchanged (sync spec → "syncPull runs migration only against post-pull state", "syncCommitAndPush remains pull-then-push by consumer contract")

## 8. Public API exports

- [x] 8.1 Export `runSyncMigrations`, `migrateProjectIdsToLowercase`, `readSyncRepoVersion`, `writeSyncRepoVersion`, and the `MigrationResult` type from `src/index.ts`. Internal utilities (`mergeMarkdownBodies`, `isMidRebaseOrMerge`) stay unexported (sync-migration spec → "Public migration API is exported from the package entry point")

## 9. Multi-device race integration test

- [x] 9.1 Add the multi-device race integration test to `test/sync-migration.test.ts`: bare remote + two clones, first device migrates and pushes, second device pulls and skips on the v2 marker. Asserts no divergent migration history (sync-migration spec → "Migration only runs after the sync repo is consistent with its remote")

## 10. Documentation

- [x] 10.1 Add a `caseSensitive` subsection to `README.md` documenting the new default and the opt-out
- [x] 10.2 Add an `## Unreleased` entry to `CHANGELOG.md` covering the additive `SyncConfig` field, the migration, the rollout fallback, and the `git-helpers.ts` extraction

## 11. Final verification

- [x] 11.1 Run `pnpm check` (lint + typecheck + test) and confirm a clean working tree
- [x] 11.2 Run `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` and verify only the files listed in `plan.md` "Files touched" appear in the diff

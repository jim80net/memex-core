## Why

`normalizeGitUrl` in `src/project-mapping.ts` preserves the case of git remote URLs, so a clone of `git@github.com:Jim80Net/Repo.git` and `git@github.com:jim80net/repo.git` collapse to two different canonical project IDs and two parallel memory trees in the sync repo. Case-insensitive routing is the correct default — but existing users already have mixed-case directories that must be migrated safely without data loss.

## What Changes

- **Add `caseSensitive?: boolean`** to `SyncConfig` (default `false`). Optional, backward-compatible.
- **Lowercase by default in `resolveProjectId`** across all three resolution paths: manual `projectMappings`, git remote URL via `normalizeGitUrl`, and the encoded `_local/` cwd fallback.
- **`normalizeGitUrl` gains an optional `caseSensitive` parameter** (default `false`). Existing callers that need case preservation must pass `true`.
- **One-shot migration** of existing sync repos: scan `projects/` for mixed-case directories, rename them to lowercase via the two-step `git mv` pattern, merge any colliding lowercase trees losslessly (markdown → concat, non-markdown → newer mtime). Gated by a new `.memex-sync/version.json` schema marker (`{ "version": 2 }`).
- **Migration runs only inside `syncPull`**, at three positions: no-remote local-only path, no-commits fresh repo path, and after a successful rebase/merge. Never on stale pre-fetch state, so two devices upgrading concurrently cannot create divergent migration commits.
- **Reader fallback** in `findMatchingProjectMemoryDirs`: case-insensitive probe of `projects/` so legacy mixed-case dirs remain visible during the rollout window between library upgrade and first post-upgrade `syncPull`.
- **Internal refactor**: extract `git`, `isGitRepo`, `hasCommits`, `hasRemote`, `getDefaultBranch` from `src/sync.ts` into a new `src/git-helpers.ts` module so `sync.ts` and the new `src/sync-migration.ts` can share them without circular imports.
- **New public API**: `runSyncMigrations`, `migrateProjectIdsToLowercase`, `readSyncRepoVersion`, `writeSyncRepoVersion`, plus the `MigrationResult` type, exported from `src/index.ts` for platform CLIs (`memex doctor`, etc.).

No BREAKING changes for end users with default config — the new lowercase behavior is additive on the writer side, and the migration heals existing data automatically. Library consumers who depended on `normalizeGitUrl` returning case-preserving output must now pass `true` explicitly.

## Capabilities

### New Capabilities

- `sync-migration`: One-shot, idempotent on-disk schema evolution for the sync repo. Owns the `.memex-sync/version.json` marker, the `migrateProjectIdsToLowercase` walker/rename/merge algorithm, the `runSyncMigrations` orchestrator (with mid-rebase/merge detection and `caseSensitive` opt-out), and the public migration API surface.
- `project-mapping`: First formal spec for the project-id resolution module. Captures the case-insensitive-by-default behavior of `normalizeGitUrl` and `resolveProjectId`, the `caseSensitive` opt-out, and the case-insensitive probe in `findMatchingProjectMemoryDirs`.
- `sync`: First formal spec for the sync orchestration module, narrowed to the pieces this change touches: `syncPull`'s migration call sites and the `syncCommitAndPush` consumer-ordering contract. Pre-existing rebase/merge/conflict-resolution behavior is documented as the baseline.

### Modified Capabilities

<!-- None — openspec/specs/ is currently empty (no baseline), so all three capabilities are introduced as New Capabilities by this change. Subsequent changes will MODIFY them. -->


## Impact

- **Affected code**: `src/types.ts`, `src/project-mapping.ts`, `src/sync.ts`, `src/index.ts`. New files `src/git-helpers.ts`, `src/sync-migration.ts`. New tests `test/sync-migration.test.ts`. Updated `test/project-mapping.test.ts`.
- **Affected APIs**: `SyncConfig.caseSensitive` field added. `normalizeGitUrl` signature gains optional second parameter. New exported migration API.
- **Affected on-disk state**: Sync repos gain a `.memex-sync/version.json` marker file at the repo root. Existing mixed-case `projects/<host>/<owner>/<repo>/memory/...` directories are renamed in-place via a one-shot migration commit.
- **Dependencies**: No new runtime dependencies.
- **Consumers** (`memex-claude`, `memex-openclaw`): No code changes required. They benefit from the new defaults automatically. Their own `SyncConfig` payloads can opt out via `caseSensitive: true` if needed.
- **Documentation**: README.md gains a `caseSensitive` subsection; CHANGELOG.md gets an unreleased entry.

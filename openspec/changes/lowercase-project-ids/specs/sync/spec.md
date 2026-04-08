## ADDED Requirements

### Requirement: Git subprocess helpers live in a shared internal module

The git subprocess helpers `git`, `isGitRepo`, `hasCommits`, `hasRemote`, and `getDefaultBranch` SHALL live in `src/git-helpers.ts` as a single internal module. Both `src/sync.ts` and `src/sync-migration.ts` SHALL import from `./git-helpers.js` to share these helpers without circular imports. The helpers themselves preserve their existing behavior — the change is purely an extraction.

#### Scenario: sync.ts imports helpers

- **WHEN** the build runs
- **THEN** `src/sync.ts` imports `git`, `isGitRepo`, `hasCommits`, `hasRemote`, and `getDefaultBranch` from `./git-helpers.js` rather than defining them locally

#### Scenario: sync-migration.ts imports helpers

- **WHEN** the build runs
- **THEN** `src/sync-migration.ts` imports the same helpers from `./git-helpers.js` and the import graph contains no cycles

### Requirement: syncPull runs migration only against post-pull state

`syncPull(config, syncRepoDir)` SHALL invoke `runSyncMigrations` at exactly three positions, all of which guarantee the working tree is consistent with the latest known remote state:

1. After `initSyncRepo` succeeds and `hasRemote` returns `false` (local-only repo). The function then returns `"no remote configured"`.
2. After `initSyncRepo` succeeds, `hasRemote` returns `true`, and `hasCommits` returns `false` (fresh repo with a remote). `runSyncMigrations` writes the marker so the first user commit carries it; the function then returns `"no commits yet"`.
3. After a successful `git fetch origin` followed by a successful rebase or merge against `origin/<default-branch>` (with conflict auto-resolution as today). Migration runs only after the pull result indicates success.

`runSyncMigrations` SHALL NOT run from `initSyncRepo`, from inside the rebase/merge conflict handling, or before `git fetch`. The "fetch failed" early-return path SHALL NOT trigger migration — offline migration would create exactly the divergent-history race that this restriction prevents.

#### Scenario: Migration runs after a successful rebase

- **WHEN** `syncPull` is called against a v1 sync repo with a reachable remote and a successful rebase
- **THEN** `runSyncMigrations` is invoked after the rebase succeeds and the migration commit lands on the local branch

#### Scenario: Migration runs on a local-only repo

- **WHEN** `syncPull` is called against a sync repo with no remote configured
- **THEN** `runSyncMigrations` is invoked once and the function returns `"no remote configured"`

#### Scenario: Migration is skipped on fetch failure

- **WHEN** `syncPull` is called and `git fetch origin` fails (network unreachable)
- **THEN** the function returns `"fetch failed (remote unreachable?)"` and `runSyncMigrations` is not called

### Requirement: syncCommitAndPush remains pull-then-push by consumer contract

`syncCommitAndPush(config, syncRepoDir, sourceDirs, cwd)` SHALL NOT invoke `runSyncMigrations` itself. The function continues to assume — as it already does today — that the consumer has called `syncPull` first. This contract is now documented explicitly. Consumers (`memex-claude`, `memex-openclaw`) follow this pattern; running migration from `syncCommitAndPush` would re-introduce the stale-local-state race that the `syncPull`-only restriction is designed to prevent.

#### Scenario: syncCommitAndPush does not run migration

- **WHEN** `syncCommitAndPush` is invoked against a v1 sync repo
- **THEN** the function copies local content into the lowercase-resolved memory directory and commits/pushes user content, but does not create a migration commit

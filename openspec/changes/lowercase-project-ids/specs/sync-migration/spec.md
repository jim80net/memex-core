## ADDED Requirements

### Requirement: Sync repo carries a versioned schema marker

The sync repo SHALL store its on-disk schema version in `<syncRepoDir>/.memex-sync/version.json` as `{ "version": <positive integer> }`. The absence of this file SHALL be treated as version `1` (legacy, case-preserving). Version `2` indicates that all project IDs under `projects/` have been normalized to lowercase.

#### Scenario: Marker file is missing

- **WHEN** `readSyncRepoVersion` is called on a sync repo with no `.memex-sync/version.json`
- **THEN** the function returns `1`

#### Scenario: Marker file is malformed JSON

- **WHEN** `readSyncRepoVersion` is called on a sync repo whose `.memex-sync/version.json` is not valid JSON
- **THEN** the function returns `1` without throwing

#### Scenario: Marker file has unexpected shape

- **WHEN** `readSyncRepoVersion` is called on a sync repo whose marker is valid JSON but lacks a numeric `version` key
- **THEN** the function returns `1`

#### Scenario: Marker round-trip

- **WHEN** `writeSyncRepoVersion(repo, 2)` runs followed by `readSyncRepoVersion(repo)`
- **THEN** the read returns `2`

### Requirement: Migration walks projects/ and renames mixed-case project IDs to lowercase

The system SHALL provide `migrateProjectIdsToLowercase(syncRepoDir)` which walks `projects/` collecting every directory that is the immediate parent of a `memory/` subdirectory, filters those whose path contains any uppercase letters, sorts them by depth descending, and renames each to its lowercase form. Renames SHALL use the canonical two-step `git mv` pattern (`git mv src src.memex-rename-tmp; git mv src.memex-rename-tmp dst`) so that case-only renames work correctly on case-insensitive filesystems (macOS APFS, Windows NTFS). The destination parent directory SHALL be created with `mkdir -p` semantics before the second move. After each rename, empty legacy ancestor directories under `projects/` SHALL be removed from the working tree.

#### Scenario: Single mixed-case project rename

- **WHEN** `projects/GitHub.com/Jim80Net/Repo/memory/notes.md` exists and `migrateProjectIdsToLowercase` runs
- **THEN** `projects/github.com/jim80net/repo/memory/notes.md` exists and the legacy `GitHub.com/` ancestor is gone

#### Scenario: Multiple mixed-case projects under a shared mixed-case parent

- **WHEN** both `projects/Host/OwnerA/RepoA/memory/a.md` and `projects/Host/OwnerB/RepoB/memory/b.md` exist
- **THEN** after migration both lowercase paths exist and the legacy `Host/` ancestor is gone

#### Scenario: No mixed-case project IDs

- **WHEN** `migrateProjectIdsToLowercase` runs against a sync repo whose `projects/` tree is already entirely lowercase
- **THEN** the function returns `{ renamed: [], merged: [] }` and the working tree is unchanged

#### Scenario: Projects directory does not exist

- **WHEN** `migrateProjectIdsToLowercase` runs against a fresh sync repo with no `projects/` directory
- **THEN** the function returns `{ renamed: [], merged: [] }` without throwing

### Requirement: Migration losslessly merges colliding lowercase trees

When a mixed-case project directory and its lowercase counterpart both exist as distinct directories on disk (only reachable on case-sensitive filesystems), the migration SHALL merge them file-by-file rather than overwriting. For each file in the legacy `memory/`:

- Files absent from the canonical side SHALL be moved across via `git mv`.
- Markdown files (`.md`) present on both sides SHALL be merged via `mergeMarkdownBodies`, which concatenates the two trimmed bodies with a blank-line separator, deduplicating if both bodies trim to the same string.
- Non-markdown files present on both sides SHALL be resolved by keeping whichever has the newer `mtime`.

After the file-by-file walk, the legacy source directory SHALL be removed via `git rm -r`.

#### Scenario: Markdown collision with differing bodies

- **WHEN** `projects/Foo/memory/notes.md` contains `"legacy body"` and `projects/foo/memory/notes.md` contains `"canonical body"`, and migration runs
- **THEN** `projects/foo/memory/notes.md` contains `"legacy body\n\ncanonical body"` and `projects/Foo/` is gone

#### Scenario: Markdown collision with identical bodies

- **WHEN** both `projects/Foo/memory/notes.md` and `projects/foo/memory/notes.md` contain the same content
- **THEN** the merged file at `projects/foo/memory/notes.md` contains exactly that content once

#### Scenario: Non-markdown collision

- **WHEN** `projects/Foo/memory/data.json` and `projects/foo/memory/data.json` both exist, and the canonical side has a strictly newer `mtime`
- **THEN** after migration `projects/foo/memory/data.json` contains the canonical content and `projects/Foo/` is gone

#### Scenario: Disjoint files across legacy and canonical

- **WHEN** `projects/Foo/memory/only-legacy.md` and `projects/foo/memory/only-canonical.md` both exist
- **THEN** after migration `projects/foo/memory/` contains both files

### Requirement: runSyncMigrations orchestrates gating, commit, and idempotency

The system SHALL provide `runSyncMigrations(config, syncRepoDir)` which is the only entry point through which `sync.ts` invokes the migration. It SHALL:

1. Return immediately when `config.caseSensitive === true` without touching the working tree.
2. Return immediately when the sync repo is in a mid-rebase or mid-merge state (`.git/rebase-merge`, `.git/rebase-apply`, or `.git/MERGE_HEAD` exists).
3. When the sync repo has no commits yet, write the v2 marker only and return without scanning or committing.
4. When the marker already reads `version >= 2`, return without scanning or committing.
5. Otherwise, run `migrateProjectIdsToLowercase`, write the v2 marker, stage all changes with `git add -A`, and create a single migration commit with the message `"memex: migrate project IDs to lowercase (schema v1 → v2)"` only if there are staged changes.

`runSyncMigrations` SHALL be idempotent: a second invocation against an already-migrated sync repo SHALL return without creating any new commits.

#### Scenario: Skipped under caseSensitive opt-out

- **WHEN** `runSyncMigrations({ ...config, caseSensitive: true }, repo)` runs against a repo containing `projects/GitHub.com/...`
- **THEN** the function returns a string containing `"case-sensitive"` and the legacy mixed-case path is unchanged

#### Scenario: Mid-rebase state detected

- **WHEN** `.git/rebase-merge/` exists in the sync repo and `runSyncMigrations` runs
- **THEN** the function returns a string containing `"mid-rebase"` and no migration is attempted

#### Scenario: Fresh repo writes marker only

- **WHEN** `runSyncMigrations` runs against a sync repo with zero commits
- **THEN** the marker file exists with `{ "version": 2 }` and no commit is created

#### Scenario: Migrates and commits in one operation

- **WHEN** `runSyncMigrations` runs against a v1 sync repo containing `projects/GitHub.com/Jim80Net/Repo/memory/notes.md`
- **THEN** the lowercase path exists, the marker reads `2`, and `git log -1 --pretty=%s` contains `"migrate project IDs to lowercase"`

#### Scenario: Idempotent second run

- **WHEN** `runSyncMigrations` is invoked twice in a row against the same sync repo
- **THEN** the second invocation returns a string containing `"already v2"` and the `HEAD` commit is unchanged

### Requirement: Migration only runs after the sync repo is consistent with its remote

The orchestration around `runSyncMigrations` SHALL ensure migration never runs against a sync repo whose state diverges from the remote when a remote is configured. Concretely, callers MUST invoke `runSyncMigrations` either after a successful `git fetch` + rebase/merge against `origin/<default-branch>`, or in a sync repo with no remote configured. Migration MUST NOT run on a stale local tree before fetching when a remote exists.

#### Scenario: Multi-device race

- **WHEN** two devices clone the same legacy bare remote, run `syncPull` in sequence, and the first device pushes its migration commit before the second runs
- **THEN** the second device's `syncPull` fetches the v2 marker, `runSyncMigrations` short-circuits on `"already v2"`, and the second device creates no additional migration commit

### Requirement: Public migration API is exported from the package entry point

The package SHALL export `runSyncMigrations`, `migrateProjectIdsToLowercase`, `readSyncRepoVersion`, `writeSyncRepoVersion`, and the `MigrationResult` type from `src/index.ts` so platform CLIs (`memex doctor`, etc.) can invoke them directly. Internal helpers (`mergeMarkdownBodies`, `isMidRebaseOrMerge`) SHALL NOT be re-exported from the package entry point.

#### Scenario: Public API import

- **WHEN** a consumer imports from `@jim80net/memex-core`
- **THEN** `runSyncMigrations`, `migrateProjectIdsToLowercase`, `readSyncRepoVersion`, `writeSyncRepoVersion`, and the `MigrationResult` type are available

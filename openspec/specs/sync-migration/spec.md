## Requirements

### Requirement: The sync repo schema version is stored in a marker file with a legacy default

The sync migration subsystem SHALL store its schema version at `<syncRepoDir>/.memex-sync/version.json`. `readSyncRepoVersion(syncRepoDir)` SHALL return `1` when the marker file is missing, unreadable, malformed JSON, or missing a positive integer `version` key. `writeSyncRepoVersion(syncRepoDir, version)` SHALL create the `.memex-sync/` directory if needed and write a JSON object containing that version.

#### Scenario: Marker file is absent or malformed

- **WHEN** `readSyncRepoVersion` runs and `.memex-sync/version.json` is missing, invalid JSON, or lacks a numeric positive `version`
- **THEN** it returns `1`

#### Scenario: Marker file round-trips a written version

- **WHEN** `writeSyncRepoVersion(syncRepoDir, 2)` runs and `readSyncRepoVersion(syncRepoDir)` is called afterward
- **THEN** the read returns `2`

### Requirement: Markdown body merging is lossless but deduplicates identical content

`mergeMarkdownBodies(a, b)` SHALL trim both markdown bodies, return one copy when the trimmed bodies are identical, and otherwise concatenate the trimmed bodies with a blank line separator.

#### Scenario: Markdown bodies differ

- **WHEN** `mergeMarkdownBodies` receives two different markdown bodies
- **THEN** it returns `a.trim() + "\n\n" + b.trim()`

#### Scenario: Markdown bodies are identical after trimming

- **WHEN** `mergeMarkdownBodies` receives bodies that trim to the same value
- **THEN** it returns that value exactly once

### Requirement: Mid-operation git states are detected before migration work starts

`isMidRebaseOrMerge(syncRepoDir)` SHALL return true when any of `.git/rebase-merge`, `.git/rebase-apply`, or `.git/MERGE_HEAD` exists in the sync repo, and false otherwise.

#### Scenario: Repo is mid-rebase or mid-merge

- **WHEN** any one of the rebase or merge sentinel paths exists under `.git/`
- **THEN** `isMidRebaseOrMerge` returns true

### Requirement: Project discovery identifies directories that directly own memory/

`findProjectIds(projectsDir)` SHALL walk the `projects/` tree recursively, collect every relative path whose directory contains a direct `memory/` child, and stop descending once such a project directory is found.

#### Scenario: Nested project IDs are discovered at memory parents only

- **WHEN** `projects/` contains nested directories where only certain directories have a direct `memory/` child
- **THEN** `findProjectIds` returns only those relative parent paths and does not recurse into their `memory/` contents

### Requirement: Case-only git renames use a two-step move sequence

`gitRenameCaseOnly(syncRepoDir, srcRelative, dstRelative)` SHALL create the destination parent directory when needed and perform a two-step rename of `srcRelative` to `srcRelative + ".memex-rename-tmp"` and then to `dstRelative` so case-only renames work on case-insensitive filesystems.

#### Scenario: Case-only rename is required

- **WHEN** a mixed-case project path must be renamed only by letter casing
- **THEN** `gitRenameCaseOnly` moves it through a temporary path before the final destination

### Requirement: Empty legacy ancestors are pruned after project relocation

`removeEmptyLegacyAncestors(syncRepoDir, srcRelative)` SHALL walk upward from the legacy path's parent directory, remove empty directories, and stop when it reaches `projects/` or finds a non-empty directory.

#### Scenario: Empty mixed-case parent directories remain after migration

- **WHEN** a project rename or merge leaves empty legacy ancestor directories under `projects/`
- **THEN** `removeEmptyLegacyAncestors` removes those empty directories but does not remove the `projects/` root

### Requirement: Project ID migration lowercases mixed-case project directories and merges collisions safely

`migrateProjectIdsToLowercase(syncRepoDir)` SHALL return `{ renamed, merged }` and operate on directories under `projects/` that are the immediate parents of `memory/` subdirectories. It SHALL ignore repos with no `projects/` directory, filter project IDs containing uppercase characters, sort them deepest-first, and rename each path to its lowercase form. For case-only renames it SHALL use `gitRenameCaseOnly`. When a distinct lowercase directory already exists, it SHALL merge the two trees file-by-file: move files that exist only in the legacy tree, merge colliding markdown files with `mergeMarkdownBodies`, keep the newer mtime for colliding non-markdown files, remove legacy files with git, and then delete the legacy tree. After either path it SHALL prune empty legacy ancestors.

#### Scenario: No projects directory exists

- **WHEN** `migrateProjectIdsToLowercase` runs in a sync repo with no `projects/` directory
- **THEN** it returns `{ renamed: [], merged: [] }`

#### Scenario: Mixed-case project is renamed without a lowercase collision

- **WHEN** `projects/GitHub.com/Jim80Net/Repo/memory/notes.md` exists and no distinct lowercase destination exists
- **THEN** the migration renames it to `projects/github.com/jim80net/repo/memory/notes.md`, records the legacy ID in `renamed`, and removes empty mixed-case ancestors

#### Scenario: Distinct lowercase project already exists on a case-sensitive filesystem

- **WHEN** both `projects/Foo/.../memory/` and `projects/foo/.../memory/` exist as distinct directories
- **THEN** the migration merges them into the lowercase destination, records the legacy ID in `merged`, and removes the legacy tree

#### Scenario: Colliding markdown files are losslessly merged

- **WHEN** the legacy and canonical trees both contain the same `.md` file with different content
- **THEN** the destination markdown file contains both trimmed bodies joined by a blank line

#### Scenario: Colliding non-markdown files keep the newer version

- **WHEN** the legacy and canonical trees both contain the same non-markdown file
- **THEN** the migrated destination keeps whichever file has the newer `mtime`

### Requirement: Migration orchestration is gated, versioned, and idempotent

`runSyncMigrations(config, syncRepoDir)` SHALL be the orchestrator for sync repo migrations. It SHALL skip immediately with a case-sensitive status string when `config.caseSensitive === true`, skip with a mid-rebase/merge status string when `isMidRebaseOrMerge(syncRepoDir)` is true, initialize only the v2 marker and return `"marker initialized (fresh repo)"` when the repo has no commits yet, and skip with `"migration skipped (already v2)"` when the version marker is already at least `2`. Otherwise it SHALL run `migrateProjectIdsToLowercase`, write schema version `2`, stage all changes with `git add -A`, and create a single commit with message `"memex: migrate project IDs to lowercase (schema v1 → v2)"` only when staged changes remain.

#### Scenario: Case-sensitive mode opts out of migration

- **WHEN** `runSyncMigrations` runs with `config.caseSensitive === true`
- **THEN** it returns a case-sensitive skip status and does not change the repo

#### Scenario: Fresh repo initializes the marker only

- **WHEN** `runSyncMigrations` runs in a repo with no commits yet
- **THEN** it writes schema version `2`, creates no commit, and returns `"marker initialized (fresh repo)"`

#### Scenario: Repo is already at schema v2

- **WHEN** `readSyncRepoVersion(syncRepoDir)` returns `2` or higher
- **THEN** `runSyncMigrations` returns `"migration skipped (already v2)"`

#### Scenario: Migration produces no staged changes after version write and scan

- **WHEN** `runSyncMigrations` stages all changes and `git status --porcelain` is empty
- **THEN** it returns `"migration: no changes (renamed X, merged Y)"` and creates no commit

#### Scenario: Migration changes are committed once

- **WHEN** migration plus marker writing leave staged changes in the sync repo
- **THEN** `runSyncMigrations` creates exactly one commit with message `"memex: migrate project IDs to lowercase (schema v1 → v2)"` and returns a summary string reporting renamed and merged counts

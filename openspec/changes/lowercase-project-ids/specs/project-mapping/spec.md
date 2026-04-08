## ADDED Requirements

### Requirement: SyncConfig carries an optional caseSensitive flag

`SyncConfig` SHALL include an optional `caseSensitive?: boolean` field. When the field is `undefined`, behavior SHALL be identical to `caseSensitive: false`. The field governs case handling across all of `normalizeGitUrl`, `resolveProjectId`, and `findMatchingProjectMemoryDirs` symmetrically.

#### Scenario: Field is optional

- **WHEN** a consumer constructs a `SyncConfig` without the `caseSensitive` field
- **THEN** TypeScript accepts the value and runtime behavior is identical to `caseSensitive: false`

### Requirement: normalizeGitUrl lowercases by default

`normalizeGitUrl(url, caseSensitive = false)` SHALL accept an optional second parameter. When `caseSensitive` is `false` (the default), the returned canonical path segment SHALL be lowercased. When `true`, the returned segment SHALL preserve the case of the input URL. Existing normalization behavior (SSH/HTTPS parsing, `.git` stripping, whitespace trimming) is otherwise unchanged.

#### Scenario: SSH URL lowercased by default

- **WHEN** `normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git")` is called
- **THEN** the result is `"github.com/jim80net/repo"`

#### Scenario: HTTPS URL lowercased by default

- **WHEN** `normalizeGitUrl("https://GitHub.com/Jim80Net/Repo.git")` is called
- **THEN** the result is `"github.com/jim80net/repo"`

#### Scenario: Case preserved with explicit opt-out

- **WHEN** `normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git", true)` is called
- **THEN** the result is `"GitHub.com/Jim80Net/Repo"`

### Requirement: resolveProjectId applies case handling symmetrically across all three resolution paths

`resolveProjectId(cwd, syncConfig)` SHALL resolve project IDs through the same three-step cascade as before — manual `projectMappings`, git remote URL, encoded `_local/` path — and SHALL apply the `syncConfig.caseSensitive` flag to all three paths uniformly. When the flag is unset or `false`, manual mapping values, normalized git URLs, and encoded path fallbacks are all lowercased before being returned. When `true`, all three preserve case.

#### Scenario: Manual mapping lowercased by default

- **WHEN** `resolveProjectId("/home/me/work", { ...config, projectMappings: { "/home/me/work": "MyOrg/MyProject" } })` is called
- **THEN** the result is `"myorg/myproject"`

#### Scenario: Manual mapping case preserved with opt-out

- **WHEN** the same call runs with `caseSensitive: true`
- **THEN** the result is `"MyOrg/MyProject"`

#### Scenario: Encoded _local fallback lowercased by default

- **WHEN** `resolveProjectId("/does-not-exist-memex-test/SomeDir", { ...config, projectMappings: {} })` is called against a cwd with no `.git` and no manual mapping
- **THEN** the result is exactly `"_local/-does-not-exist-memex-test-somedir"`

#### Scenario: Encoded _local fallback case preserved with opt-out

- **WHEN** `resolveProjectId("/does-not-exist-memex-test/SomeDir", { ...config, projectMappings: {}, caseSensitive: true })` is called
- **THEN** the result is exactly `"_local/-does-not-exist-memex-test-SomeDir"`

### Requirement: findMatchingProjectMemoryDirs probes for legacy mixed-case directories

`findMatchingProjectMemoryDirs(cwd, syncRepoPath, syncConfig)` SHALL return all of:

1. The canonical (lowercase, default) memory directory under `projects/<canonicalId>/memory` if it exists.
2. The `_local/<encoded>` fallback memory directory if it exists and differs from the canonical path.
3. **When `syncConfig.caseSensitive` is not `true`**, any directory under `projects/` whose path (relative to `projects/`) lowercases to the canonical ID and is not equal to it. This case-insensitive probe walks `projects/` only along path prefixes that could lowercase-match the canonical ID (no full-tree scan).

This rollout fallback covers the window between a library upgrade and the first post-upgrade `syncPull`, when legacy mixed-case directories still exist but writes have already shifted to lowercase paths. The fallback SHALL be a fast no-op once migration has completed (no mixed-case siblings remain).

#### Scenario: Legacy mixed-case path is found by case-insensitive probe

- **WHEN** the sync repo has `projects/GitHub.com/Jim80Net/Repo/memory/notes.md` but no canonical lowercase counterpart, and `findMatchingProjectMemoryDirs` is called with a cwd whose canonical ID is `github.com/jim80net/repo`
- **THEN** the returned list contains the legacy mixed-case `memory/` path

#### Scenario: Canonical path is still returned when it exists

- **WHEN** the sync repo has `projects/github.com/jim80net/repo/memory/` and `findMatchingProjectMemoryDirs` is called for the matching cwd
- **THEN** the returned list contains the canonical `memory/` path

#### Scenario: Probe is skipped under caseSensitive opt-out

- **WHEN** `findMatchingProjectMemoryDirs` is called with `syncConfig.caseSensitive === true`
- **THEN** only the canonical path and the `_local/` fallback are checked; no case-insensitive probe runs

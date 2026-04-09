## Requirements

### Requirement: Git remote URLs normalize into canonical project IDs

`normalizeGitUrl(url, caseSensitive = false)` SHALL trim whitespace, strip a trailing `.git` suffix, normalize SSH remotes of the form `git@host:owner/repo` into `host/owner/repo`, normalize parseable URL remotes into `host/path`, and lowercase the result by default. When `caseSensitive` is true, it SHALL preserve the input case instead. If URL parsing fails for a non-SSH string, it SHALL return the raw trimmed string lowercased by default or unchanged in case-sensitive mode.

#### Scenario: SSH remote is normalized

- **WHEN** `normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git")` is called
- **THEN** it returns `"github.com/jim80net/repo"`

#### Scenario: HTTPS remote is normalized

- **WHEN** `normalizeGitUrl("https://GitHub.com/Jim80Net/Repo.git")` is called
- **THEN** it returns `"github.com/jim80net/repo"`

#### Scenario: Case-sensitive normalization preserves case

- **WHEN** `normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git", true)` is called
- **THEN** it returns `"GitHub.com/Jim80Net/Repo"`

#### Scenario: Unparseable remote falls through to the raw string

- **WHEN** `normalizeGitUrl` receives a non-SSH remote string that cannot be parsed as a URL
- **THEN** it returns that trimmed string lowercased by default, or with original case when `caseSensitive` is true

### Requirement: Local path encoding produces filesystem-safe fallback project IDs

`encodeProjectPath(cwd)` SHALL encode local directory paths by replacing every `/`, `.`, and `_` character with `-` while preserving consecutive hyphens that result from those substitutions.

#### Scenario: Local path is encoded for fallback storage

- **WHEN** `encodeProjectPath("/home/user/.my_project")` is called
- **THEN** it returns `"-home-user--my-project"`

### Requirement: Git remote lookup returns origin or null

`getGitRemoteUrl(cwd)` SHALL run `git remote get-url origin` in the target directory, trim the result, return the URL when a non-empty string is produced, and return `null` on any subprocess failure or empty output.

#### Scenario: Directory is not a git repo or has no origin

- **WHEN** `git remote get-url origin` fails or returns an empty string for `cwd`
- **THEN** `getGitRemoteUrl` returns `null`

### Requirement: Project ID resolution uses manual mappings, git remotes, and local fallbacks in order

`resolveProjectId(cwd, syncConfig)` SHALL resolve a canonical project ID through a three-step cascade: first `syncConfig.projectMappings[cwd]`, then `getGitRemoteUrl(cwd)` normalized through `normalizeGitUrl`, and finally the encoded local fallback `_local/<encodeProjectPath(cwd)>`. The `caseSensitive` flag SHALL be applied symmetrically across all three paths: manual mappings are lowercased by default, git remotes are normalized with the same policy, and encoded `_local/` fallbacks are lowercased by default or preserved when `caseSensitive === true`.

#### Scenario: Manual mapping wins over git metadata

- **WHEN** `syncConfig.projectMappings` contains an entry for `cwd`
- **THEN** `resolveProjectId` returns that mapped value normalized according to `caseSensitive` without consulting git

#### Scenario: Manual mapping lowercases by default

- **WHEN** `resolveProjectId("/home/me/work", { ...syncConfig, projectMappings: { "/home/me/work": "MyOrg/MyProject" } })` is called with `caseSensitive` unset or false
- **THEN** it returns `"myorg/myproject"`

#### Scenario: Manual mapping preserves case in case-sensitive mode

- **WHEN** `resolveProjectId("/home/me/work", { ...syncConfig, caseSensitive: true, projectMappings: { "/home/me/work": "MyOrg/MyProject" } })` is called
- **THEN** it returns `"MyOrg/MyProject"`

#### Scenario: Git remote is used when no manual mapping exists

- **WHEN** no manual mapping exists for `cwd` and `getGitRemoteUrl(cwd)` returns a remote URL
- **THEN** `resolveProjectId` returns the normalized git remote ID

#### Scenario: Local fallback is used when no mapping or git remote exists

- **WHEN** `cwd` has no manual mapping and `getGitRemoteUrl(cwd)` returns `null`
- **THEN** `resolveProjectId` returns `_local/<encoded-path>` normalized according to `caseSensitive`

#### Scenario: Local fallback lowercases by default

- **WHEN** `resolveProjectId("/does-not-exist-memex-test/SomeDir", { ...syncConfig, projectMappings: {} })` is called and no git remote can be resolved
- **THEN** it returns `"_local/-does-not-exist-memex-test-somedir"`

#### Scenario: Local fallback preserves case in case-sensitive mode

- **WHEN** `resolveProjectId("/does-not-exist-memex-test/SomeDir", { ...syncConfig, caseSensitive: true, projectMappings: {} })` is called and no git remote can be resolved
- **THEN** it returns `"_local/-does-not-exist-memex-test-SomeDir"`

### Requirement: Matching memory directory discovery returns canonical, local, and rollout-window legacy paths

`findMatchingProjectMemoryDirs(cwd, syncRepoPath, syncConfig)` SHALL return all matching project memory directories for the current working directory. It SHALL include the canonical memory directory at `projects/<canonicalId>/memory` when it exists, include the `_local/<encoded>/memory` fallback when it exists, and when `caseSensitive` is not true it SHALL also probe for legacy mixed-case project directories whose lowercased relative path equals the canonical ID. Legacy probing SHALL walk only along directory prefixes that can lowercase-match the target ID, and multiple matches SHALL be returned during the rollout window.

#### Scenario: Canonical memory directory exists

- **WHEN** `projects/<canonicalId>/memory` exists in the sync repo
- **THEN** `findMatchingProjectMemoryDirs` includes that directory in its result set

#### Scenario: _local fallback exists during non-git usage

- **WHEN** `projects/_local/<encodeProjectPath(cwd)>/memory` exists in the sync repo
- **THEN** `findMatchingProjectMemoryDirs` includes that fallback directory in its result set

#### Scenario: Legacy mixed-case project path is still present

- **WHEN** `caseSensitive` is not true and a legacy mixed-case project directory lowercases to the canonical project ID
- **THEN** `findMatchingProjectMemoryDirs` includes the legacy `memory/` directory alongside any canonical or `_local` matches

#### Scenario: Case-sensitive mode skips legacy mixed-case probing

- **WHEN** `syncConfig.caseSensitive === true`
- **THEN** `findMatchingProjectMemoryDirs` checks only the canonical and `_local` locations and does not perform the case-insensitive legacy walk

### Requirement: The sync project memory destination always uses the canonical project ID

`getSyncProjectMemoryDir(cwd, syncRepoPath, syncConfig)` SHALL resolve the canonical project ID with `resolveProjectId` and return `projects/<canonicalId>/memory` rooted at `syncRepoPath`.

#### Scenario: Canonical sync memory path is requested

- **WHEN** `getSyncProjectMemoryDir(cwd, syncRepoPath, syncConfig)` is called
- **THEN** it returns the canonical project memory directory under `projects/<resolved-project-id>/memory`

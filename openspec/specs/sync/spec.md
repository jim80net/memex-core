## Requirements

### Requirement: Markdown conflict auto-resolution preserves both sides without conflict markers

`autoResolveMarkdownConflict(content)` SHALL replace inline git conflict markers in markdown with merged body content. For each `<<<<<<<` / `=======` / `>>>>>>>` block, it SHALL trim both sides, keep only one copy when the trimmed bodies are identical, and otherwise concatenate the trimmed bodies with a blank line between them.

#### Scenario: Conflicting markdown bodies differ

- **WHEN** `autoResolveMarkdownConflict` receives a markdown file containing one git conflict block whose two sides differ after trimming
- **THEN** the returned content replaces the conflict markers with `ours + "\n\n" + theirs`

#### Scenario: Conflicting markdown bodies are identical after trimming

- **WHEN** `autoResolveMarkdownConflict` receives a conflict block whose two sides trim to the same body
- **THEN** the returned content keeps that body exactly once and removes the conflict markers

### Requirement: Sync repo initialization ensures a local repo and configured origin

`initSyncRepo(config, syncRepoDir)` SHALL return immediately when sync is disabled or `config.repo` is empty. Otherwise it SHALL create `syncRepoDir`, reuse an existing git repo when present, and ensure the `origin` remote points at `config.repo`. If the directory is not yet a git repo, it SHALL try `git clone <repo> <syncRepoDir>` first and fall back to `git init` plus `git remote add origin <repo>` when cloning fails.

#### Scenario: Existing repo has a different origin URL

- **WHEN** `initSyncRepo` runs in a directory that is already a git repo and `origin` points somewhere other than `config.repo`
- **THEN** it updates `origin` to `config.repo` and leaves the repo in place

#### Scenario: Existing repo has no origin remote

- **WHEN** `initSyncRepo` runs in a directory that is already a git repo but `remote get-url origin` fails
- **THEN** it adds `origin` pointing at `config.repo`

#### Scenario: Clone falls back to init plus remote add

- **WHEN** `initSyncRepo` runs in a non-repo directory and `git clone` fails
- **THEN** it initializes a new git repo in `syncRepoDir` and adds `origin` with `config.repo`

### Requirement: syncPull gates sync work before pulling and runs migration only on safe states

`syncPull(config, syncRepoDir)` SHALL return `"sync disabled"` without touching the repo when sync is disabled or `config.repo` is empty. Otherwise it SHALL initialize the repo, short-circuit local-only and fresh-repo cases before fetching, fetch from `origin`, determine the default branch, call `pullWithConflictResolution(syncRepoDir, "origin/<default-branch>")`, and run `runSyncMigrations(config, syncRepoDir)` only after a successful pull or when the repo has no remote configured.

#### Scenario: No remote configured after initialization

- **WHEN** `syncPull` runs after `initSyncRepo` and `hasRemote(syncRepoDir)` returns false
- **THEN** it runs `runSyncMigrations` once and returns `"no remote configured"`

#### Scenario: Repo has a remote but no commits yet

- **WHEN** `syncPull` runs and `hasRemote(syncRepoDir)` returns true while `hasCommits(syncRepoDir)` returns false
- **THEN** it returns `"no commits yet"` and defers migration until commits exist

#### Scenario: Fetch fails before pull

- **WHEN** `git fetch origin` fails during `syncPull`
- **THEN** the function returns `"fetch failed (remote unreachable?)"` and does not run pull conflict resolution or post-pull migration

#### Scenario: Pull succeeds and migration runs afterward

- **WHEN** fetch succeeds and `pullWithConflictResolution` returns a non-failure status string
- **THEN** `syncPull` runs `runSyncMigrations` after the pull and returns the pull status string

### Requirement: Pull conflict resolution prefers rebase, then merge, with automatic file resolution

`pullWithConflictResolution(syncRepoDir, remoteBranch)` SHALL attempt `git rebase <remoteBranch>` first. If rebase fails, it SHALL inspect unresolved files, auto-resolve markdown conflicts by rewriting the file with `autoResolveMarkdownConflict`, auto-resolve non-markdown conflicts by checking out `--theirs`, and stage every resolved file. If a resolved rebase can continue, it SHALL return `"pulled with auto-resolved conflicts: ..."`; otherwise it SHALL abort the rebase and fall back to `git merge <remoteBranch> --no-edit`. A clean merge SHALL return `"pulled (merge)"`. A merge with auto-resolved conflicts SHALL commit `"Auto-resolve merge conflicts"` and return `"pulled with merge + auto-resolved: ..."`. If neither rebase nor merge can be resolved automatically, it SHALL abort the merge when possible and return `"pull failed: unresolvable conflicts"`.

#### Scenario: Rebase succeeds without conflicts

- **WHEN** `git rebase <remoteBranch>` succeeds on the first attempt
- **THEN** `pullWithConflictResolution` returns `"pulled successfully"`

#### Scenario: Rebase conflicts are auto-resolved and continued

- **WHEN** rebase fails, `resolveConflicts` stages one or more files, and `git rebase --continue` succeeds
- **THEN** the function returns `"pulled with auto-resolved conflicts: ..."`

#### Scenario: Rebase aborts and merge succeeds cleanly

- **WHEN** rebase cannot continue after conflict handling but `git merge <remoteBranch> --no-edit` succeeds
- **THEN** the function returns `"pulled (merge)"`

#### Scenario: Merge conflicts are auto-resolved

- **WHEN** both rebase and clean merge fail, but merge conflict handling resolves one or more files
- **THEN** the function creates a merge commit with message `"Auto-resolve merge conflicts"` and returns `"pulled with merge + auto-resolved: ..."`

#### Scenario: Conflicts remain unresolvable

- **WHEN** neither the rebase path nor the merge path produces any auto-resolved files that can complete the operation
- **THEN** the function returns `"pull failed: unresolvable conflicts"`

### Requirement: syncCommitAndPush copies tracked content into the sync repo, commits once, and pushes

`syncCommitAndPush(config, syncRepoDir, sourceDirs, cwd)` SHALL return `"sync disabled"` when sync is disabled or `config.repo` is empty. Otherwise it SHALL initialize the repo, copy rules from `sourceDirs.rules` into `<syncRepoDir>/rules`, copy skill definitions from `sourceDirs.skills` into `<syncRepoDir>/skills`, resolve the canonical project memory destination with `getSyncProjectMemoryDir(cwd, syncRepoDir, config)`, and copy markdown project memories into that destination. If nothing is copied, it SHALL return `"no changes to sync"`. When copied content exists, it SHALL stage all changes, return `"no changes after staging"` if staging reveals no git diff, commit once with a message of the form `sync from <hostname> at <timestamp>`, and then push to the default branch by trying `git push` first and `git push -u origin <branch>` as a fallback.

#### Scenario: No files need copying

- **WHEN** the rules, skills, and project memory sync helpers all report zero copied files
- **THEN** `syncCommitAndPush` returns `"no changes to sync"`

#### Scenario: Commit succeeds but no remote is configured

- **WHEN** content is copied and committed but `hasRemote(syncRepoDir)` returns false before pushing
- **THEN** the function returns `"committed (no remote)"`

#### Scenario: Direct push fails but upstream push succeeds

- **WHEN** the commit succeeds, `git push` fails, and `git push -u origin <default-branch>` succeeds
- **THEN** the function returns `"synced <count> file(s)"`

#### Scenario: Push fails after a successful commit

- **WHEN** the commit succeeds but both push attempts fail
- **THEN** the function returns `"committed locally, push failed: ..."`

### Requirement: syncDirectory copies matching files only when the source is newer

`syncDirectory(srcDir, destDir, pattern)` SHALL return `0` when `srcDir` cannot be read. Otherwise it SHALL filter directory entries by the suffix implied by `pattern`, skip non-files and unreadable entries, compare source and destination mtimes, create `destDir` when a copy is needed, and write the source content into the destination only when the destination is missing or older than the source.

#### Scenario: Destination file is up to date

- **WHEN** a source file matches the requested pattern but the destination file exists with `mtime >= src.mtime`
- **THEN** `syncDirectory` leaves the destination untouched and does not count the file as copied

#### Scenario: Destination file is missing or stale

- **WHEN** a source file matches the requested pattern and the destination file is missing or older
- **THEN** `syncDirectory` creates the destination directory if needed, writes the file, and increments the copied count

### Requirement: syncSkillsDirectory copies SKILL.md from named skill folders when newer

`syncSkillsDirectory(srcDir, destDir)` SHALL return `0` when `srcDir` cannot be read. Otherwise it SHALL treat each immediate child entry as a skill folder, inspect `<entry>/SKILL.md`, skip missing or unreadable skill files, compare mtimes against `<destDir>/<entry>/SKILL.md`, create destination skill folders when copying, and write only newer or missing `SKILL.md` files.

#### Scenario: Skill definition is copied into a matching subdirectory

- **WHEN** `<srcDir>/<skill>/SKILL.md` exists and the destination file is missing or older
- **THEN** `syncSkillsDirectory` creates `<destDir>/<skill>/` if needed, copies `SKILL.md`, and increments the copied count

### Requirement: getSyncScanDirs exposes the sync repo scan roots

`getSyncScanDirs(syncRepoPath)` SHALL return `{ rulesDir, skillsDir }` where `rulesDir` is `<syncRepoPath>/rules` and `skillsDir` is `<syncRepoPath>/skills`.

#### Scenario: Scan roots are derived from the sync repo path

- **WHEN** `getSyncScanDirs(syncRepoPath)` is called
- **THEN** it returns the `rules/` and `skills/` directories rooted at that sync repo path

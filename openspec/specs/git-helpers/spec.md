## Requirements

### Requirement: Git subprocess wrapper with timeout

`git(args, cwd)` SHALL execute `git` with the given arguments in the specified working directory with a 30-second timeout. It returns `{ stdout, stderr }` on success and throws on non-zero exit codes.

#### Scenario: Successful git command

- **WHEN** `git(["rev-parse", "--git-dir"], "/path/to/repo")` is called in a valid git repo
- **THEN** the function returns `{ stdout: string, stderr: string }` with the command output

#### Scenario: Non-zero exit code

- **WHEN** `git(["checkout", "nonexistent-branch"], "/path/to/repo")` is called and git exits with code 128
- **THEN** the function throws with the error details

### Requirement: isGitRepo detects git repositories

`isGitRepo(dir)` SHALL return `true` if `git rev-parse --git-dir` succeeds in the given directory, `false` otherwise.

#### Scenario: Valid git repository

- **WHEN** `isGitRepo` is called on a directory containing a `.git` folder
- **THEN** the function returns `true`

#### Scenario: Non-git directory

- **WHEN** `isGitRepo` is called on a directory without a `.git` folder
- **THEN** the function returns `false`

### Requirement: hasRemote checks for configured remotes

`hasRemote(dir)` SHALL return `true` if `git remote` produces non-empty output, `false` otherwise.

#### Scenario: Remote configured

- **WHEN** `hasRemote` is called on a repo with `origin` configured
- **THEN** the function returns `true`

#### Scenario: No remotes

- **WHEN** `hasRemote` is called on a freshly `git init`-ed repo with no remotes
- **THEN** the function returns `false`

### Requirement: hasCommits checks for any commits

`hasCommits(dir)` SHALL return `true` if `git rev-parse HEAD` succeeds (at least one commit exists), `false` otherwise.

#### Scenario: Repo with commits

- **WHEN** `hasCommits` is called on a repo that has at least one commit
- **THEN** the function returns `true`

#### Scenario: Empty repo with no commits

- **WHEN** `hasCommits` is called on a freshly `git init`-ed repo with zero commits
- **THEN** the function returns `false`

### Requirement: getDefaultBranch resolves the default branch name

`getDefaultBranch(dir)` SHALL determine the default branch name through a three-step cascade:
1. Try `git symbolic-ref refs/remotes/origin/HEAD` and extract the branch name.
2. If that fails, try `git ls-remote --symref origin HEAD` and parse the branch from the ref.
3. If both fail, return `"main"` as the fallback.

#### Scenario: Symbolic ref resolves

- **WHEN** `git symbolic-ref refs/remotes/origin/HEAD` outputs `refs/remotes/origin/main`
- **THEN** `getDefaultBranch` returns `"main"`

#### Scenario: ls-remote fallback

- **WHEN** `symbolic-ref` fails but `ls-remote --symref origin HEAD` outputs `ref: refs/heads/develop`
- **THEN** `getDefaultBranch` returns `"develop"`

#### Scenario: Default fallback

- **WHEN** both `symbolic-ref` and `ls-remote` fail
- **THEN** `getDefaultBranch` returns `"main"`
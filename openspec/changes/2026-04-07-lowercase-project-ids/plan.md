# Lowercase Project IDs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship case-insensitive-by-default project ID routing in memex-core with a one-shot migration of existing mixed-case sync repos.

**Architecture:** Add `caseSensitive?: boolean` flag to `SyncConfig` (default `false`). Lowercase all three resolution paths in `resolveProjectId`. Introduce a `.memex-sync/version.json` marker and a one-shot migration that runs only after a successful pull inside `syncPull`. A reader fallback in `findMatchingProjectMemoryDirs` handles the rollout window between upgrade and first pull.

**Tech Stack:** TypeScript (ESM, NodeNext), Vitest, Node.js `node:fs/promises` + `node:child_process` git subprocess. No new runtime dependencies.

**Spec:** `openspec/changes/2026-04-07-lowercase-project-ids/design.md`

---

## File Structure

**New files:**

| File | Responsibility |
|------|----------------|
| `src/git-helpers.ts` | Shared git subprocess helpers (`git`, `isGitRepo`, `hasCommits`, `hasRemote`, `getDefaultBranch`). Single responsibility: run git commands and answer basic repo-state questions. |
| `src/sync-migration.ts` | On-disk sync repo schema evolution: marker read/write, mid-rebase detection, project ID walker, `migrateProjectIdsToLowercase`, `runSyncMigrations` orchestrator, `mergeMarkdownBodies`, `isMidRebaseOrMerge`. |
| `test/sync-migration.test.ts` | Migration test suite using real `git init` in tmpdir. |

**Modified files:**

| File | Change |
|------|--------|
| `src/types.ts` | Add `caseSensitive?: boolean` to `SyncConfig`. |
| `src/project-mapping.ts` | Lowercase by default in `normalizeGitUrl` + `resolveProjectId`; case-insensitive fallback in `findMatchingProjectMemoryDirs`. |
| `src/sync.ts` | Remove local git helper definitions (imported from `./git-helpers.js` instead); call `runSyncMigrations` at three positions inside `syncPull`. `initSyncRepo` is unchanged. |
| `src/index.ts` | Export `migrateProjectIdsToLowercase`, `runSyncMigrations`. |
| `test/project-mapping.test.ts` | Add cases for lowercase normalization and the `caseSensitive` flag. |
| `README.md` | Document the `caseSensitive` flag and the one-shot migration. |
| `CHANGELOG.md` | Add entry under a new unreleased/next-version section. |

---

## Test Helper Setup

Several tasks below (Task 6 onward) need a real git repo in a tmpdir. Use this exact setup block in `test/sync-migration.test.ts`:

```typescript
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const runGit = (args: string[], cwd: string) =>
  execFileAsync("git", args, { cwd, timeout: 30_000 });

let repoDir: string;

beforeEach(async () => {
  repoDir = await mkdtemp(join(tmpdir(), "memex-migration-"));
  await runGit(["init", "--initial-branch=main"], repoDir);
  await runGit(["config", "user.email", "test@memex.local"], repoDir);
  await runGit(["config", "user.name", "Memex Test"], repoDir);
  await runGit(["commit", "--allow-empty", "-m", "init"], repoDir);
});

afterEach(async () => {
  await rm(repoDir, { recursive: true, force: true });
});

async function writeTracked(repo: string, relPath: string, content: string): Promise<void> {
  const abs = join(repo, relPath);
  await mkdir(join(abs, ".."), { recursive: true });
  await writeFile(abs, content, "utf-8");
}
```

The empty `init` commit is important: several tests need `hasCommits(repoDir) === true` to exercise the non-fresh-repo code path.

---

## Task 1: Add `caseSensitive` field to `SyncConfig`

**Files:**
- Modify: `src/types.ts:198-204`

- [ ] **Step 1: Add the field**

Edit `src/types.ts` to extend the `SyncConfig` type:

```typescript
// ---------------------------------------------------------------------------
// Sync config
// ---------------------------------------------------------------------------

export type SyncConfig = {
  enabled: boolean;
  repo: string;
  autoPull: boolean;
  autoCommitPush: boolean;
  projectMappings: Record<string, string>; // local path → canonical project id
  /**
   * When true, project IDs preserve the case of git remote URLs, manual mappings,
   * and encoded cwd paths. When false or undefined (default), project IDs are
   * lowercased across all three resolution paths.
   */
  caseSensitive?: boolean;
};
```

- [ ] **Step 2: Verify types compile**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify existing tests still pass**

Run: `npx vitest run`
Expected: all existing tests pass (the new optional field is backward-compatible).

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat(types): add caseSensitive field to SyncConfig

Optional flag (default false) that will govern whether project IDs
are lowercased across manual mappings, git remote URLs, and encoded
path fallbacks. Behavior changes land in subsequent commits."
```

---

## Task 2: Extract git helpers into `src/git-helpers.ts`

**Files:**
- Create: `src/git-helpers.ts`
- Modify: `src/sync.ts:1-61`

This is a pure refactor — no behavior change. Existing sync tests must still pass after the move.

- [ ] **Step 1: Create `src/git-helpers.ts`**

Create the file with exactly this content:

```typescript
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a git command inside a directory. 30s timeout.
 */
export async function git(
  args: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd, timeout: 30_000 });
}

export async function isGitRepo(dir: string): Promise<boolean> {
  try {
    await git(["rev-parse", "--git-dir"], dir);
    return true;
  } catch {
    return false;
  }
}

export async function hasRemote(dir: string): Promise<boolean> {
  try {
    const { stdout } = await git(["remote"], dir);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}

export async function hasCommits(dir: string): Promise<boolean> {
  try {
    await git(["rev-parse", "HEAD"], dir);
    return true;
  } catch {
    return false;
  }
}

export async function getDefaultBranch(dir: string): Promise<string> {
  try {
    const { stdout } = await git(["symbolic-ref", "refs/remotes/origin/HEAD"], dir);
    const ref = stdout.trim();
    const branch = ref.replace(/^refs\/remotes\/origin\//, "");
    if (branch) return branch;
  } catch {
    try {
      const { stdout } = await git(["ls-remote", "--symref", "origin", "HEAD"], dir);
      const match = stdout.match(/ref:\s+refs\/heads\/(\S+)/);
      if (match) return match[1];
    } catch {
      // Fall through to default
    }
  }
  return "main";
}
```

- [ ] **Step 2: Update `src/sync.ts` to import the helpers**

Replace the top of `src/sync.ts` — from line 1 through and including the `// Git helpers` block that ends at line 61 (the closing brace of `getDefaultBranch`) — with:

```typescript
import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getDefaultBranch, git, hasCommits, hasRemote, isGitRepo } from "./git-helpers.js";
import { getSyncProjectMemoryDir } from "./project-mapping.js";
import type { SyncConfig } from "./types.js";

const execFileAsync = promisify(execFile);
```

Do **not** include a `// Conflict resolution` header in this replacement block — the existing one immediately below the removed git helpers (originally around line 63) is left intact, so adding another would duplicate it.

The helper function definitions (`git`, `isGitRepo`, `hasRemote`, `hasCommits`, `getDefaultBranch`) are gone — they live in `git-helpers.ts` now. `execFileAsync` is kept local because `sync.ts` still uses it for `git clone` (no cwd) and `hostname`.

**Verify the diff before moving on:**

Run: `git diff src/sync.ts | head -80`
Expected: only the git-helpers import line is added plus the five function definitions removed. The `// Conflict resolution` header below should appear unchanged in the diff context, not duplicated.

- [ ] **Step 3: Verify build + tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: build clean, all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/git-helpers.ts src/sync.ts
git commit -m "refactor(sync): extract git helpers into git-helpers.ts

Pure refactor. Makes the helpers shareable with sync-migration.ts
without causing circular imports. No behavior change."
```

---

## Task 3: Lowercase `normalizeGitUrl` by default

**Files:**
- Modify: `src/project-mapping.ts:18-37`
- Modify: `test/project-mapping.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/project-mapping.test.ts` inside the existing `describe("normalizeGitUrl", ...)` block:

```typescript
  it("lowercases the host and path by default", () => {
    expect(normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git")).toBe(
      "github.com/jim80net/repo",
    );
  });

  it("lowercases HTTPS URLs by default", () => {
    expect(normalizeGitUrl("https://GitHub.com/Jim80Net/Repo.git")).toBe(
      "github.com/jim80net/repo",
    );
  });

  it("preserves case when caseSensitive is true", () => {
    expect(normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git", true)).toBe(
      "GitHub.com/Jim80Net/Repo",
    );
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/project-mapping.test.ts`
Expected: three new tests FAIL with assertion errors (uppercase letters in output).

- [ ] **Step 3: Implement the lowercase default**

Replace the `normalizeGitUrl` function body in `src/project-mapping.ts` (lines 18–37) with:

```typescript
/**
 * Normalize a git remote URL to a canonical path segment.
 * Handles SSH, HTTPS, and .git suffix variations.
 *
 * By default the result is lowercased so that clones of the same repo with
 * different casing (`GitHub.com:Jim80Net/Repo` vs `github.com:jim80net/repo`)
 * collapse onto a single canonical project id. Pass `caseSensitive = true`
 * to preserve the original case.
 *
 * Examples:
 *   git@github.com:jim80net/repo.git → github.com/jim80net/repo
 *   git@GitHub.com:Jim80Net/Repo.git → github.com/jim80net/repo
 *   https://github.com/jim80net/repo.git → github.com/jim80net/repo
 */
export function normalizeGitUrl(url: string, caseSensitive = false): string {
  let normalized = url.trim();

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, "");

  // SSH format: git@host:owner/repo
  const sshMatch = normalized.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch) {
    const result = `${sshMatch[1]}/${sshMatch[2]}`;
    return caseSensitive ? result : result.toLowerCase();
  }

  // HTTPS format: https://host/owner/repo
  try {
    const parsed = new URL(normalized);
    const result = `${parsed.host}${parsed.pathname}`.replace(/^\//, "").replace(/\/$/, "");
    return caseSensitive ? result : result.toLowerCase();
  } catch {
    return caseSensitive ? normalized : normalized.toLowerCase();
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/project-mapping.test.ts`
Expected: all `normalizeGitUrl` tests pass (old + three new).

- [ ] **Step 5: Commit**

```bash
git add src/project-mapping.ts test/project-mapping.test.ts
git commit -m "feat(project-mapping): lowercase normalizeGitUrl by default

Add optional caseSensitive parameter (default false). Mixed-case
clones of the same repo now collapse to a single canonical project
id like github.com/jim80net/repo."
```

---

## Task 4: Lowercase `resolveProjectId` symmetrically

**Files:**
- Modify: `src/project-mapping.ts:55-77`
- Modify: `test/project-mapping.test.ts`

- [ ] **Step 1: Write failing tests**

Append a new `describe` block to `test/project-mapping.test.ts`:

```typescript
describe("resolveProjectId", () => {
  const baseConfig = {
    enabled: true,
    repo: "",
    autoPull: false,
    autoCommitPush: false,
    projectMappings: {} as Record<string, string>,
  };

  it("lowercases manual mapping values by default", async () => {
    const config = {
      ...baseConfig,
      projectMappings: { "/home/me/work": "MyOrg/MyProject" },
    };
    expect(await resolveProjectId("/home/me/work", config)).toBe("myorg/myproject");
  });

  it("preserves case in manual mappings when caseSensitive is true", async () => {
    const config = {
      ...baseConfig,
      projectMappings: { "/home/me/work": "MyOrg/MyProject" },
      caseSensitive: true,
    };
    expect(await resolveProjectId("/home/me/work", config)).toBe("MyOrg/MyProject");
  });

  it("lowercases _local encoded path fallback by default", async () => {
    // Use a guaranteed-nonexistent path so getGitRemoteUrl returns null
    // and we fall through to the encoded-path branch deterministically.
    const id = await resolveProjectId("/does-not-exist-memex-test/SomeDir", baseConfig);
    expect(id).toBe("_local/-does-not-exist-memex-test-somedir");
  });

  it("preserves encoded path case when caseSensitive is true", async () => {
    const id = await resolveProjectId("/does-not-exist-memex-test/SomeDir", {
      ...baseConfig,
      caseSensitive: true,
    });
    expect(id).toBe("_local/-does-not-exist-memex-test-SomeDir");
  });
});
```

Add `resolveProjectId` to the existing import line at the top of `test/project-mapping.test.ts`:

```typescript
import { normalizeGitUrl, resolveProjectId } from "../src/project-mapping.ts";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/project-mapping.test.ts`
Expected: all four new `resolveProjectId` tests FAIL.

- [ ] **Step 3: Implement the symmetric lowercasing**

Replace the `resolveProjectId` function in `src/project-mapping.ts` (lines 55–77) with:

```typescript
/**
 * Resolve the canonical project identifier for a given cwd.
 *
 * Resolution cascade:
 * 1. Manual mapping from config (explicit override)
 * 2. Git remote URL → normalized to host/owner/repo
 * 3. Encoded cwd path → stored under _local/
 *
 * All three paths are lowercased by default. Set `syncConfig.caseSensitive`
 * to `true` to preserve the original casing.
 */
export async function resolveProjectId(cwd: string, syncConfig: SyncConfig): Promise<string> {
  const preserveCase = syncConfig.caseSensitive === true;
  const norm = (s: string) => (preserveCase ? s : s.toLowerCase());

  // 1. Manual mapping
  if (syncConfig.projectMappings[cwd]) {
    return norm(syncConfig.projectMappings[cwd]);
  }

  // 2. Git remote URL
  const remoteUrl = await getGitRemoteUrl(cwd);
  if (remoteUrl) {
    return normalizeGitUrl(remoteUrl, preserveCase);
  }

  // 3. Encoded path fallback
  return `_local/${norm(encodeProjectPath(cwd))}`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/project-mapping.test.ts`
Expected: all tests in `resolveProjectId` describe block pass.

- [ ] **Step 5: Commit**

```bash
git add src/project-mapping.ts test/project-mapping.test.ts
git commit -m "feat(project-mapping): lowercase resolveProjectId by default

Apply caseSensitive flag symmetrically to all three resolution paths
(manual mappings, git remote, encoded _local fallback)."
```

---

## Task 5: Rollout fallback in `findMatchingProjectMemoryDirs`

**Files:**
- Modify: `src/project-mapping.ts:79-112`
- Modify: `test/project-mapping.test.ts`

Without this, the window between "user upgrades library" and "user's first `syncPull`" will make legacy mixed-case memories invisible to readers.

- [ ] **Step 1: Write failing test**

Append to `test/project-mapping.test.ts`:

```typescript
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("findMatchingProjectMemoryDirs - rollout fallback", () => {
  let syncRepo: string;

  beforeEach(async () => {
    syncRepo = await mkdtemp(join(tmpdir(), "memex-reader-"));
  });

  afterEach(async () => {
    await rm(syncRepo, { recursive: true, force: true });
  });

  it("finds legacy mixed-case project dirs via case-insensitive probe", async () => {
    // Simulate legacy state: mixed-case dir exists, lowercase canonical does not
    const legacyMemDir = join(syncRepo, "projects", "GitHub.com", "Jim80Net", "Repo", "memory");
    await mkdir(legacyMemDir, { recursive: true });
    await writeFile(join(legacyMemDir, "notes.md"), "legacy", "utf-8");

    // A caller whose resolveProjectId returns the lowercase canonical id
    const config = {
      enabled: true,
      repo: "",
      autoPull: false,
      autoCommitPush: false,
      projectMappings: { "/fake/cwd": "github.com/jim80net/repo" },
    };

    const matches = await findMatchingProjectMemoryDirs("/fake/cwd", syncRepo, config);
    expect(matches).toContain(legacyMemDir);
  });

  it("still returns canonical path when it exists", async () => {
    const canonicalMemDir = join(syncRepo, "projects", "github.com", "jim80net", "repo", "memory");
    await mkdir(canonicalMemDir, { recursive: true });

    const config = {
      enabled: true,
      repo: "",
      autoPull: false,
      autoCommitPush: false,
      projectMappings: { "/fake/cwd": "github.com/jim80net/repo" },
    };

    const matches = await findMatchingProjectMemoryDirs("/fake/cwd", syncRepo, config);
    expect(matches).toContain(canonicalMemDir);
  });
});
```

Add imports at the top if missing:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findMatchingProjectMemoryDirs, normalizeGitUrl, resolveProjectId } from "../src/project-mapping.ts";
```

- [ ] **Step 2: Run tests to verify the first one fails**

Run: `npx vitest run test/project-mapping.test.ts`
Expected: the legacy-mixed-case test FAILS. The canonical test PASSES already.

- [ ] **Step 3: Implement the case-insensitive probe**

Replace `findMatchingProjectMemoryDirs` in `src/project-mapping.ts` (lines 79–112) with:

```typescript
/**
 * Find all project memory directories in the sync repo that match the current cwd.
 *
 * Returns:
 * - The canonical (lowercase) memory dir if it exists.
 * - The `_local/<encoded>` fallback if it exists and differs from the canonical.
 * - Any legacy mixed-case directory whose lowercase form equals the canonical id
 *   (rollout window before a post-upgrade sync has migrated the repo).
 *
 * Multiple matches are expected during the upgrade window; callers should merge
 * their contents.
 */
export async function findMatchingProjectMemoryDirs(
  cwd: string,
  syncRepoPath: string,
  syncConfig: SyncConfig,
): Promise<string[]> {
  const projectsDir = join(syncRepoPath, "projects");
  const matches = new Set<string>();

  const canonicalId = await resolveProjectId(cwd, syncConfig);
  const canonicalMemDir = join(projectsDir, canonicalId, "memory");
  try {
    await stat(canonicalMemDir);
    matches.add(canonicalMemDir);
  } catch {
    // doesn't exist yet
  }

  const encodedPath = encodeProjectPath(cwd);
  const localMemDir = join(projectsDir, "_local", encodedPath, "memory");
  try {
    await stat(localMemDir);
    matches.add(localMemDir);
  } catch {
    // doesn't exist
  }

  // Rollout-window fallback: walk projects/ and collect any directory whose
  // lowercase path (relative to projects/) equals canonicalId. This catches
  // legacy mixed-case dirs that have not yet been migrated.
  if (!syncConfig.caseSensitive) {
    const legacyMatches = await findLegacyMixedCaseMemoryDirs(projectsDir, canonicalId);
    for (const m of legacyMatches) matches.add(m);
  }

  return [...matches];
}

/**
 * Walk projects/ collecting every memory/ parent directory whose relative
 * path (lowercased) equals targetId. Skips the already-canonical lowercase path.
 */
async function findLegacyMixedCaseMemoryDirs(
  projectsDir: string,
  targetId: string,
): Promise<string[]> {
  const results: string[] = [];
  const targetDepth = targetId.split("/").length;

  async function walk(relativeDir: string, depth: number): Promise<void> {
    if (depth > targetDepth) return;

    const absDir = join(projectsDir, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    if (depth === targetDepth) {
      // Leaf of the project id — check for memory/ child
      const hasMemory = entries.some((e) => e.isDirectory() && e.name === "memory");
      if (hasMemory && relativeDir.toLowerCase() === targetId && relativeDir !== targetId) {
        results.push(join(absDir, "memory"));
      }
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "memory") continue;
      // Only recurse into candidates that could lowercase-match the target prefix
      const childRel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      const targetPrefix = targetId.split("/").slice(0, depth + 1).join("/");
      if (childRel.toLowerCase() === targetPrefix) {
        await walk(childRel, depth + 1);
      }
    }
  }

  await walk("", 0);
  return results;
}
```

Add `readdir` to the existing import at the top of `src/project-mapping.ts`:

```typescript
import { readdir, stat } from "node:fs/promises";
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/project-mapping.test.ts`
Expected: all rollout fallback tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/project-mapping.ts test/project-mapping.test.ts
git commit -m "feat(project-mapping): case-insensitive rollout fallback in reader

findMatchingProjectMemoryDirs now probes projects/ for legacy mixed-case
dirs whose lowercase form equals the canonical id. Prevents memory loss
in the window between library upgrade and first post-upgrade syncPull."
```

---

## Task 6: Create `sync-migration.ts` scaffold with marker + utility helpers

**Files:**
- Create: `src/sync-migration.ts`
- Create: `test/sync-migration.test.ts`

This task only introduces the small helpers (`readSyncRepoVersion`, `writeSyncRepoVersion`, `mergeMarkdownBodies`, `isMidRebaseOrMerge`). The big `migrateProjectIdsToLowercase` and `runSyncMigrations` come in later tasks.

- [ ] **Step 1: Create the test file with the setup helpers and first tests**

Create `test/sync-migration.test.ts` with the full setup block from the [Test Helper Setup](#test-helper-setup) section above, plus these test blocks:

```typescript
import {
  isMidRebaseOrMerge,
  mergeMarkdownBodies,
  readSyncRepoVersion,
  writeSyncRepoVersion,
} from "../src/sync-migration.ts";

describe("sync repo version marker", () => {
  it("returns 1 when marker is missing (legacy default)", async () => {
    expect(await readSyncRepoVersion(repoDir)).toBe(1);
  });

  it("round-trips a written version", async () => {
    await writeSyncRepoVersion(repoDir, 2);
    expect(await readSyncRepoVersion(repoDir)).toBe(2);
  });

  it("returns 1 when marker is malformed JSON", async () => {
    await mkdir(join(repoDir, ".memex-sync"), { recursive: true });
    await writeFile(join(repoDir, ".memex-sync", "version.json"), "not json", "utf-8");
    expect(await readSyncRepoVersion(repoDir)).toBe(1);
  });

  it("returns 1 when marker has wrong shape", async () => {
    await mkdir(join(repoDir, ".memex-sync"), { recursive: true });
    await writeFile(join(repoDir, ".memex-sync", "version.json"), '{"foo": 99}', "utf-8");
    expect(await readSyncRepoVersion(repoDir)).toBe(1);
  });
});

describe("mergeMarkdownBodies", () => {
  it("concatenates different bodies", () => {
    expect(mergeMarkdownBodies("# A", "# B")).toBe("# A\n\n# B");
  });

  it("dedupes identical bodies", () => {
    expect(mergeMarkdownBodies("same\n", "same")).toBe("same");
  });

  it("trims surrounding whitespace", () => {
    expect(mergeMarkdownBodies("  # A  \n\n", "\n# B\n")).toBe("# A\n\n# B");
  });
});

describe("isMidRebaseOrMerge", () => {
  it("returns false in a clean repo", async () => {
    expect(await isMidRebaseOrMerge(repoDir)).toBe(false);
  });

  it("returns true when .git/rebase-merge exists", async () => {
    await mkdir(join(repoDir, ".git", "rebase-merge"), { recursive: true });
    expect(await isMidRebaseOrMerge(repoDir)).toBe(true);
  });

  it("returns true when .git/rebase-apply exists", async () => {
    await mkdir(join(repoDir, ".git", "rebase-apply"), { recursive: true });
    expect(await isMidRebaseOrMerge(repoDir)).toBe(true);
  });

  it("returns true when .git/MERGE_HEAD exists", async () => {
    await writeFile(join(repoDir, ".git", "MERGE_HEAD"), "abc123\n", "utf-8");
    expect(await isMidRebaseOrMerge(repoDir)).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: all tests FAIL with "cannot find module '../src/sync-migration.ts'".

- [ ] **Step 3: Create `src/sync-migration.ts` with the four helpers**

```typescript
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Sync repo version marker
// ---------------------------------------------------------------------------

const MARKER_DIR = ".memex-sync";
const MARKER_FILE = "version.json";

function markerPath(syncRepoDir: string): string {
  return join(syncRepoDir, MARKER_DIR, MARKER_FILE);
}

/**
 * Read the on-disk sync repo schema version. Returns 1 (legacy default) if
 * the marker file is missing, unreadable, malformed JSON, or has an unexpected
 * shape. Any positive integer at the `version` key is returned as-is.
 */
export async function readSyncRepoVersion(syncRepoDir: string): Promise<number> {
  try {
    const raw = await readFile(markerPath(syncRepoDir), "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      "version" in parsed &&
      typeof (parsed as { version: unknown }).version === "number" &&
      Number.isInteger((parsed as { version: number }).version) &&
      (parsed as { version: number }).version > 0
    ) {
      return (parsed as { version: number }).version;
    }
    return 1;
  } catch {
    return 1;
  }
}

/**
 * Write the sync repo schema version marker, creating `.memex-sync/` if needed.
 */
export async function writeSyncRepoVersion(syncRepoDir: string, version: number): Promise<void> {
  await mkdir(join(syncRepoDir, MARKER_DIR), { recursive: true });
  const content = `${JSON.stringify({ version }, null, 2)}\n`;
  await writeFile(markerPath(syncRepoDir), content, "utf-8");
}

// ---------------------------------------------------------------------------
// Markdown merge (two separate files, not inline conflict markers)
// ---------------------------------------------------------------------------

/**
 * Merge two markdown file bodies for the migration's "true merge" path.
 * Not the same as `autoResolveMarkdownConflict` in sync.ts, which handles
 * inline git conflict markers within a single file.
 *
 * Lossless: concatenates both bodies with a blank line. Deduplicates if the
 * trimmed bodies are identical.
 */
export function mergeMarkdownBodies(a: string, b: string): string {
  const at = a.trim();
  const bt = b.trim();
  if (at === bt) return at;
  return `${at}\n\n${bt}`;
}

// ---------------------------------------------------------------------------
// Mid-rebase / mid-merge detection
// ---------------------------------------------------------------------------

/**
 * Detects whether the sync repo is currently in a mid-rebase or mid-merge
 * state. Used by the migration orchestrator to bail out cleanly instead of
 * operating on a broken tree.
 */
export async function isMidRebaseOrMerge(syncRepoDir: string): Promise<boolean> {
  const candidates = [
    join(syncRepoDir, ".git", "rebase-merge"),
    join(syncRepoDir, ".git", "rebase-apply"),
    join(syncRepoDir, ".git", "MERGE_HEAD"),
  ];
  for (const path of candidates) {
    try {
      await stat(path);
      return true;
    } catch {
      // not present, continue
    }
  }
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: all 11 tests in the three describe blocks pass.

- [ ] **Step 5: Commit**

```bash
git add src/sync-migration.ts test/sync-migration.test.ts
git commit -m "feat(sync-migration): add marker + utility helpers scaffold

Introduces readSyncRepoVersion, writeSyncRepoVersion, mergeMarkdownBodies,
isMidRebaseOrMerge. The big migrateProjectIdsToLowercase and orchestrator
land in subsequent commits."
```

---

## Task 7: Implement `migrateProjectIdsToLowercase` — case-only rename path

**Files:**
- Modify: `src/sync-migration.ts`
- Modify: `test/sync-migration.test.ts`

This task handles the common case: mixed-case directory exists, no lowercase collision. True merge (when both mixed-case and lowercase dirs exist) comes in Task 8.

- [ ] **Step 1: Write failing tests**

Append to `test/sync-migration.test.ts`:

```typescript
import { migrateProjectIdsToLowercase } from "../src/sync-migration.ts";
import { readdir } from "node:fs/promises";

describe("migrateProjectIdsToLowercase - case-only rename", () => {
  it("returns empty result when projects/ does not exist", async () => {
    const result = await migrateProjectIdsToLowercase(repoDir);
    expect(result).toEqual({ renamed: [], merged: [] });
  });

  it("returns empty result when no mixed-case dirs exist", async () => {
    await writeTracked(repoDir, "projects/github.com/foo/bar/memory/notes.md", "clean");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed"], repoDir);

    const result = await migrateProjectIdsToLowercase(repoDir);
    expect(result).toEqual({ renamed: [], merged: [] });
  });

  it("renames a single mixed-case project id", async () => {
    await writeTracked(repoDir, "projects/GitHub.com/Jim80Net/Repo/memory/notes.md", "hi");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed legacy"], repoDir);

    const result = await migrateProjectIdsToLowercase(repoDir);

    expect(result.renamed).toEqual(["GitHub.com/Jim80Net/Repo"]);
    expect(result.merged).toEqual([]);

    // Verify the new path exists and the old path does not
    const newFile = join(repoDir, "projects/github.com/jim80net/repo/memory/notes.md");
    await expect(stat(newFile)).resolves.toBeDefined();

    const legacyEntries = await readdir(join(repoDir, "projects"));
    expect(legacyEntries).not.toContain("GitHub.com");
  });

  it("renames deepest-first so parents do not clobber children", async () => {
    await writeTracked(repoDir, "projects/Host/OwnerA/RepoA/memory/a.md", "a");
    await writeTracked(repoDir, "projects/Host/OwnerB/RepoB/memory/b.md", "b");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed two legacy"], repoDir);

    const result = await migrateProjectIdsToLowercase(repoDir);

    expect(new Set(result.renamed)).toEqual(
      new Set(["Host/OwnerA/RepoA", "Host/OwnerB/RepoB"]),
    );

    await expect(
      stat(join(repoDir, "projects/host/ownera/repoa/memory/a.md")),
    ).resolves.toBeDefined();
    await expect(
      stat(join(repoDir, "projects/host/ownerb/repob/memory/b.md")),
    ).resolves.toBeDefined();
  });
});
```

Add this import near the top of the test file:

```typescript
import { stat } from "node:fs/promises";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: the four case-only-rename tests FAIL with "migrateProjectIdsToLowercase is not exported".

- [ ] **Step 3: Add new imports to the top of `src/sync-migration.ts`**

Replace the existing top-of-file import block in `src/sync-migration.ts` with:

```typescript
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git } from "./git-helpers.js";
```

- [ ] **Step 4: Implement `migrateProjectIdsToLowercase` (rename-only path)**

Append to `src/sync-migration.ts` (below the existing helpers from Task 6):

```typescript
// ---------------------------------------------------------------------------
// Project ID migration
// ---------------------------------------------------------------------------

export type MigrationResult = {
  renamed: string[];
  merged: string[];
};

/**
 * Walk `projects/` and return every relative path that is the immediate
 * parent of a `memory/` subdirectory. Those paths are project ids.
 *
 * Does not recurse into a project id once found — `memory/` content is not
 * scanned for nested project ids.
 */
async function findProjectIds(projectsDir: string): Promise<string[]> {
  const results: string[] = [];

  async function walk(relativeDir: string): Promise<void> {
    const absDir = join(projectsDir, relativeDir);
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch {
      return;
    }

    const hasMemory = entries.some((e) => e.isDirectory() && e.name === "memory");
    if (hasMemory && relativeDir !== "") {
      results.push(relativeDir);
      return;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "memory") continue;
      const childRel = relativeDir ? `${relativeDir}/${entry.name}` : entry.name;
      await walk(childRel);
    }
  }

  await walk("");
  return results;
}

function hasUppercase(s: string): boolean {
  return s !== s.toLowerCase();
}

/**
 * Rename a single mixed-case project directory to its lowercase form using
 * the two-step pattern. Safe on both case-sensitive and case-insensitive
 * filesystems (macOS APFS, Windows NTFS).
 *
 * The caller is responsible for making sure srcRelative exists — any failure
 * from `git mv` propagates up.
 */
async function gitRenameCaseOnly(
  syncRepoDir: string,
  srcRelative: string,
  dstRelative: string,
): Promise<void> {
  const tmpRelative = `${srcRelative}.memex-rename-tmp`;
  // Ensure the destination parent directory exists (git mv does not create it).
  const dstParent = dirname(join(syncRepoDir, dstRelative));
  await mkdir(dstParent, { recursive: true });
  await git(["mv", srcRelative, tmpRelative], syncRepoDir);
  await git(["mv", tmpRelative, dstRelative], syncRepoDir);
}

/**
 * After a rename, walk upward from the legacy source path removing empty
 * directories until we hit `projects/`. Git doesn't track empty dirs so
 * `git rm` is not needed — plain `fs.rm` on the working tree is enough.
 */
async function removeEmptyLegacyAncestors(
  syncRepoDir: string,
  srcRelative: string,
): Promise<void> {
  const projectsRoot = join(syncRepoDir, "projects");
  let current = dirname(join(syncRepoDir, srcRelative));
  while (current !== projectsRoot && current.startsWith(projectsRoot)) {
    let entries: string[];
    try {
      entries = await readdir(current);
    } catch {
      return;
    }
    if (entries.length > 0) return;
    try {
      await rm(current, { recursive: false });
    } catch {
      return;
    }
    current = dirname(current);
  }
}

/**
 * Walk `projects/` and rename mixed-case project ids to their lowercase form.
 *
 * Returns counts of renamed (case-only rename, no lowercase collision) and
 * merged (lowercase target already existed — case-sensitive FS only) paths.
 *
 * Does not commit. Callers own the commit decision. Safe to run in a clean
 * working tree — staged changes may confuse callers of `git add -A` afterward.
 */
export async function migrateProjectIdsToLowercase(
  syncRepoDir: string,
): Promise<MigrationResult> {
  const projectsDir = join(syncRepoDir, "projects");

  try {
    await stat(projectsDir);
  } catch {
    return { renamed: [], merged: [] };
  }

  const allIds = await findProjectIds(projectsDir);
  const mixedCase = allIds.filter(hasUppercase);

  // Rename deepest paths first so that renaming a parent doesn't shift the
  // location of a child that still needs renaming.
  mixedCase.sort((a, b) => b.split("/").length - a.split("/").length);

  const renamed: string[] = [];
  const merged: string[] = [];

  for (const src of mixedCase) {
    const dst = src.toLowerCase();
    const srcRelative = `projects/${src}`;
    const dstRelative = `projects/${dst}`;

    // Does a lowercase destination already exist as a distinct directory?
    // On case-insensitive filesystems, stat() of the lowercase form resolves
    // to the same inode as the mixed-case form. We detect that by comparing
    // inodes; if they match, it's a case-only rename (not a merge).
    const srcAbs = join(syncRepoDir, srcRelative);
    const dstAbs = join(syncRepoDir, dstRelative);
    let isDistinctMerge = false;
    try {
      const [srcStat, dstStat] = await Promise.all([stat(srcAbs), stat(dstAbs)]);
      isDistinctMerge = !(srcStat.ino === dstStat.ino && srcStat.dev === dstStat.dev);
    } catch {
      isDistinctMerge = false; // dst doesn't exist → plain rename
    }

    if (isDistinctMerge) {
      // True merge path — implemented in Task 8
      throw new Error(
        `migrateProjectIdsToLowercase: merge path not yet implemented for ${src}`,
      );
    }

    await gitRenameCaseOnly(syncRepoDir, srcRelative, dstRelative);
    await removeEmptyLegacyAncestors(syncRepoDir, srcRelative);
    renamed.push(src);
  }

  return { renamed, merged };
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: all four case-only-rename tests pass. The merge path still throws (no tests exercise it yet).

- [ ] **Step 6: Commit**

```bash
git add src/sync-migration.ts test/sync-migration.test.ts
git commit -m "feat(sync-migration): case-only rename path for project ID migration

Walks projects/ finding memory-parent dirs, filters to mixed-case,
sorts deepest-first, renames each with the two-step git mv pattern
(creating destination parents, cleaning up empty legacy ancestors).
True merge path is stubbed to throw and lands in the next commit."
```

---

## Task 8: Implement `migrateProjectIdsToLowercase` — true merge path

**Files:**
- Modify: `src/sync-migration.ts`
- Modify: `test/sync-migration.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/sync-migration.test.ts`:

```typescript
describe("migrateProjectIdsToLowercase - true merge path", () => {
  // Skip on case-insensitive filesystems where the merge case is unreachable.
  // Detect by trying to create both Foo/ and foo/ as siblings.
  const isCaseSensitive = async (): Promise<boolean> => {
    const probe = await mkdtemp(join(tmpdir(), "memex-probe-"));
    try {
      await mkdir(join(probe, "Foo"));
      try {
        await mkdir(join(probe, "foo"));
        return true;
      } catch {
        return false;
      }
    } finally {
      await rm(probe, { recursive: true, force: true });
    }
  };

  it("concatenates differing markdown bodies", async () => {
    if (!(await isCaseSensitive())) {
      return; // unreachable on macOS APFS / Windows NTFS
    }

    await writeTracked(repoDir, "projects/Foo/memory/notes.md", "legacy body");
    await writeTracked(repoDir, "projects/foo/memory/notes.md", "canonical body");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed both"], repoDir);

    const result = await migrateProjectIdsToLowercase(repoDir);
    expect(result.merged).toEqual(["Foo"]);
    expect(result.renamed).toEqual([]);

    const merged = await readFile(join(repoDir, "projects/foo/memory/notes.md"), "utf-8");
    expect(merged).toBe("legacy body\n\ncanonical body");

    // Legacy dir should be gone
    const entries = await readdir(join(repoDir, "projects"));
    expect(entries).not.toContain("Foo");
  });

  it("dedupes identical markdown bodies", async () => {
    if (!(await isCaseSensitive())) return;

    await writeTracked(repoDir, "projects/Foo/memory/notes.md", "same content");
    await writeTracked(repoDir, "projects/foo/memory/notes.md", "same content");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed identical"], repoDir);

    await migrateProjectIdsToLowercase(repoDir);

    const merged = await readFile(join(repoDir, "projects/foo/memory/notes.md"), "utf-8");
    expect(merged).toBe("same content");
  });

  it("moves files present only in legacy side", async () => {
    if (!(await isCaseSensitive())) return;

    await writeTracked(repoDir, "projects/Foo/memory/only-legacy.md", "legacy only");
    await writeTracked(repoDir, "projects/foo/memory/only-canonical.md", "canonical only");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed disjoint"], repoDir);

    await migrateProjectIdsToLowercase(repoDir);

    const canonicalEntries = await readdir(join(repoDir, "projects/foo/memory"));
    expect(canonicalEntries.sort()).toEqual(["only-canonical.md", "only-legacy.md"]);
  });

  it("keeps the newer file for non-markdown collisions", async () => {
    if (!(await isCaseSensitive())) return;

    await writeTracked(repoDir, "projects/Foo/memory/data.json", '{"v":"old"}');
    await writeTracked(repoDir, "projects/foo/memory/data.json", '{"v":"new"}');
    // Ensure canonical is newer
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed json"], repoDir);
    const legacyPath = join(repoDir, "projects/Foo/memory/data.json");
    const canonicalPath = join(repoDir, "projects/foo/memory/data.json");
    const now = Date.now() / 1000;
    await utimes(legacyPath, now - 100, now - 100);
    await utimes(canonicalPath, now, now);

    await migrateProjectIdsToLowercase(repoDir);

    const content = await readFile(canonicalPath, "utf-8");
    expect(content).toBe('{"v":"new"}');
  });
});
```

Add `mkdtemp`, `rm`, `mkdir`, `readFile`, `utimes` to the imports at the top of the test file:

```typescript
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile,
} from "node:fs/promises";
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: merge-path tests FAIL with the stub error ("merge path not yet implemented"). Tests from Task 7 still pass.

- [ ] **Step 3: Implement the merge path**

Replace the `if (isDistinctMerge) { throw ... }` block in `migrateProjectIdsToLowercase` with a real call, and add two new helper functions. The full updated section of `src/sync-migration.ts`:

```typescript
// ... keep everything up to the for loop unchanged ...

    if (isDistinctMerge) {
      await mergeProjectDirs(syncRepoDir, srcRelative, dstRelative);
      merged.push(src);
      continue;
    }

    await gitRenameCaseOnly(syncRepoDir, srcRelative, dstRelative);
    renamed.push(src);
  }

  return { renamed, merged };
}

/**
 * Merge the contents of two distinct project directories (only reachable on
 * case-sensitive filesystems where both `Foo/` and `foo/` exist as separate
 * inodes). Walks `src/memory/` file-by-file:
 *
 * - File absent in dst → `git mv` into dst.
 * - Markdown file present in both → read both bodies, merge losslessly with
 *   `mergeMarkdownBodies`, write to dst, `git rm` src.
 * - Non-markdown file present in both → keep whichever has the newer mtime.
 *
 * After the walk, `git rm -r` the now-empty source directory.
 */
async function mergeProjectDirs(
  syncRepoDir: string,
  srcRelative: string,
  dstRelative: string,
): Promise<void> {
  const srcMemoryRel = `${srcRelative}/memory`;
  const dstMemoryRel = `${dstRelative}/memory`;
  const srcMemoryAbs = join(syncRepoDir, srcMemoryRel);
  const dstMemoryAbs = join(syncRepoDir, dstMemoryRel);

  let entries: import("node:fs").Dirent[];
  try {
    entries = await readdir(srcMemoryAbs, { withFileTypes: true });
  } catch {
    entries = [];
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;

    const srcFileRel = `${srcMemoryRel}/${entry.name}`;
    const dstFileRel = `${dstMemoryRel}/${entry.name}`;
    const srcFileAbs = join(syncRepoDir, srcFileRel);
    const dstFileAbs = join(syncRepoDir, dstFileRel);

    let dstExists = false;
    try {
      await stat(dstFileAbs);
      dstExists = true;
    } catch {
      dstExists = false;
    }

    if (!dstExists) {
      await git(["mv", srcFileRel, dstFileRel], syncRepoDir);
      continue;
    }

    if (entry.name.endsWith(".md")) {
      const [srcBody, dstBody] = await Promise.all([
        readFile(srcFileAbs, "utf-8"),
        readFile(dstFileAbs, "utf-8"),
      ]);
      const merged = mergeMarkdownBodies(srcBody, dstBody);
      await writeFile(dstFileAbs, merged, "utf-8");
      await git(["add", dstFileRel], syncRepoDir);
      await git(["rm", srcFileRel], syncRepoDir);
    } else {
      const [srcStat, dstStat] = await Promise.all([stat(srcFileAbs), stat(dstFileAbs)]);
      if (srcStat.mtimeMs > dstStat.mtimeMs) {
        // src is newer — replace dst with src content
        const content = await readFile(srcFileAbs);
        await writeFile(dstFileAbs, content);
        await git(["add", dstFileRel], syncRepoDir);
      }
      // either way, remove src
      await git(["rm", srcFileRel], syncRepoDir);
    }
  }

  // Walk any remaining files in src/memory/ (shouldn't be any post-loop)
  // and then remove the now-empty src project directory tree via git rm -r.
  await git(["rm", "-r", srcRelative], syncRepoDir);
}
```

No new imports needed — `readFile`, `writeFile`, `readdir`, `stat` are already in the top-of-file import block from Task 7.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: all merge-path tests pass (or are skipped on case-insensitive FS).

- [ ] **Step 5: Commit**

```bash
git add src/sync-migration.ts test/sync-migration.test.ts
git commit -m "feat(sync-migration): true merge path for case-sensitive FS collisions

When both Foo/ and foo/ exist as distinct inodes, walk src/memory/
file-by-file: markdown files concat losslessly via mergeMarkdownBodies,
non-markdown files keep the newer mtime, then git rm -r the legacy src."
```

---

## Task 9: Implement `runSyncMigrations` orchestrator

**Files:**
- Modify: `src/sync-migration.ts`
- Modify: `test/sync-migration.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/sync-migration.test.ts`:

```typescript
import { runSyncMigrations } from "../src/sync-migration.ts";
import type { SyncConfig } from "../src/types.ts";

const baseSyncConfig: SyncConfig = {
  enabled: true,
  repo: "",
  autoPull: false,
  autoCommitPush: false,
  projectMappings: {},
};

describe("runSyncMigrations", () => {
  it("skips when caseSensitive is true", async () => {
    await writeTracked(repoDir, "projects/GitHub.com/foo/bar/memory/notes.md", "hi");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed"], repoDir);

    const result = await runSyncMigrations(
      { ...baseSyncConfig, caseSensitive: true },
      repoDir,
    );

    expect(result).toContain("case-sensitive");
    // Legacy path is untouched
    await expect(
      stat(join(repoDir, "projects/GitHub.com/foo/bar/memory/notes.md")),
    ).resolves.toBeDefined();
  });

  it("writes marker and no migration commit on a fresh repo", async () => {
    // Wipe the initial empty commit so hasCommits returns false
    await rm(join(repoDir, ".git"), { recursive: true, force: true });
    await runGit(["init", "--initial-branch=main"], repoDir);
    await runGit(["config", "user.email", "test@memex.local"], repoDir);
    await runGit(["config", "user.name", "Memex Test"], repoDir);

    const result = await runSyncMigrations(baseSyncConfig, repoDir);

    expect(result).toContain("fresh repo");
    expect(await readSyncRepoVersion(repoDir)).toBe(2);
  });

  it("bails cleanly on mid-rebase state", async () => {
    await mkdir(join(repoDir, ".git", "rebase-merge"), { recursive: true });
    const result = await runSyncMigrations(baseSyncConfig, repoDir);
    expect(result).toContain("mid-rebase");
  });

  it("skips when version is already 2", async () => {
    await writeTracked(repoDir, "projects/GitHub.com/foo/bar/memory/notes.md", "hi");
    await writeSyncRepoVersion(repoDir, 2);
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "already v2"], repoDir);

    const result = await runSyncMigrations(baseSyncConfig, repoDir);

    expect(result).toContain("already v2");
    // Legacy path untouched — migration did not run
    await expect(
      stat(join(repoDir, "projects/GitHub.com/foo/bar/memory/notes.md")),
    ).resolves.toBeDefined();
  });

  it("migrates, writes marker, and commits in one operation", async () => {
    await writeTracked(repoDir, "projects/GitHub.com/Jim80Net/Repo/memory/notes.md", "hi");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed legacy"], repoDir);

    const headBefore = (await runGit(["rev-parse", "HEAD"], repoDir)).stdout.trim();

    const result = await runSyncMigrations(baseSyncConfig, repoDir);

    expect(result).toMatch(/migrated 1 dir/);
    expect(await readSyncRepoVersion(repoDir)).toBe(2);

    // Verify a new commit was created
    const headAfter = (await runGit(["rev-parse", "HEAD"], repoDir)).stdout.trim();
    expect(headAfter).not.toBe(headBefore);

    // Verify commit message mentions migration
    const { stdout: logOut } = await runGit(["log", "-1", "--pretty=%s"], repoDir);
    expect(logOut).toContain("migrate project IDs to lowercase");

    // Verify the lowercase tree exists
    await expect(
      stat(join(repoDir, "projects/github.com/jim80net/repo/memory/notes.md")),
    ).resolves.toBeDefined();
  });

  it("is idempotent on a second run", async () => {
    await writeTracked(repoDir, "projects/GitHub.com/Jim80Net/Repo/memory/notes.md", "hi");
    await runGit(["add", "-A"], repoDir);
    await runGit(["commit", "-m", "seed legacy"], repoDir);

    await runSyncMigrations(baseSyncConfig, repoDir);
    const headAfterFirst = (await runGit(["rev-parse", "HEAD"], repoDir)).stdout.trim();

    const secondResult = await runSyncMigrations(baseSyncConfig, repoDir);
    const headAfterSecond = (await runGit(["rev-parse", "HEAD"], repoDir)).stdout.trim();

    expect(secondResult).toContain("already v2");
    expect(headAfterSecond).toBe(headAfterFirst); // no new commit
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: new `runSyncMigrations` tests FAIL with "runSyncMigrations is not exported".

- [ ] **Step 3: Extend the top-of-file imports in `src/sync-migration.ts`**

Update the top-of-file import block so that `hasCommits` is added from `./git-helpers.js` (next to the existing `git` import) and `SyncConfig` is imported from `./types.js`:

```typescript
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git, hasCommits } from "./git-helpers.js";
import type { SyncConfig } from "./types.js";
```

- [ ] **Step 4: Implement `runSyncMigrations`**

Append to `src/sync-migration.ts` (after the merge path added in Task 8):

```typescript
// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

/**
 * Run all pending sync repo migrations. Idempotent. Safe to call repeatedly
 * from the top of `syncPull` — it becomes a no-op once the v2 marker is
 * written.
 *
 * IMPORTANT: Callers must only invoke this after pulling the latest remote
 * state (or in a local-only repo with no remote). Running on stale local
 * state when a remote exists can cause divergent migration commits across
 * devices. See `openspec/changes/2026-04-07-lowercase-project-ids/design.md`
 * section 4.
 */
export async function runSyncMigrations(
  config: SyncConfig,
  syncRepoDir: string,
): Promise<string> {
  if (config.caseSensitive === true) {
    return "migration skipped (case-sensitive mode)";
  }

  if (await isMidRebaseOrMerge(syncRepoDir)) {
    return "migration skipped (mid-rebase/merge state)";
  }

  if (!(await hasCommits(syncRepoDir))) {
    // Fresh repo — nothing to scan. Write the marker so the first user
    // commit carries it.
    await writeSyncRepoVersion(syncRepoDir, 2);
    return "marker initialized (fresh repo)";
  }

  const version = await readSyncRepoVersion(syncRepoDir);
  if (version >= 2) {
    return "migration skipped (already v2)";
  }

  const result = await migrateProjectIdsToLowercase(syncRepoDir);
  await writeSyncRepoVersion(syncRepoDir, 2);

  await git(["add", "-A"], syncRepoDir);
  const { stdout } = await git(["status", "--porcelain"], syncRepoDir);
  if (!stdout.trim()) {
    return `migration: no changes (renamed ${result.renamed.length}, merged ${result.merged.length})`;
  }

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

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run test/sync-migration.test.ts`
Expected: all `runSyncMigrations` tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/sync-migration.ts test/sync-migration.test.ts
git commit -m "feat(sync-migration): add runSyncMigrations orchestrator

Gates on caseSensitive flag, mid-rebase state, hasCommits, and the
version marker. Writes v2 marker + commits the migration in one shot.
Idempotent: second run short-circuits on 'already v2'."
```

---

## Task 10: Wire `runSyncMigrations` into `syncPull`

**Files:**
- Modify: `src/sync.ts:149-201`

- [ ] **Step 1: Update the import block in `src/sync.ts`**

Add `runSyncMigrations` to the existing import near the top:

```typescript
import { runSyncMigrations } from "./sync-migration.js";
```

- [ ] **Step 2: Wire migration into `syncPull` at three positions**

Replace the `syncPull` function body (sync.ts:149-201) with:

```typescript
export async function syncPull(config: SyncConfig, syncRepoDir: string): Promise<string> {
  if (!config.enabled || !config.repo) return "sync disabled";

  await initSyncRepo(config, syncRepoDir);

  if (!(await hasRemote(syncRepoDir))) {
    // Local-only repo — migrate without remote coordination concerns.
    await runSyncMigrations(config, syncRepoDir);
    return "no remote configured";
  }

  if (!(await hasCommits(syncRepoDir))) {
    // Fresh repo with a remote configured but nothing fetched yet.
    // runSyncMigrations writes the marker so the first user commit carries it.
    await runSyncMigrations(config, syncRepoDir);
    return "no commits yet";
  }

  try {
    await git(["fetch", "origin"], syncRepoDir);
  } catch {
    return "fetch failed (remote unreachable?)";
  }

  const defaultBranch = await getDefaultBranch(syncRepoDir);
  const remoteBranch = `origin/${defaultBranch}`;

  const pullResult = await pullWithConflictResolution(syncRepoDir, remoteBranch);
  if (pullResult.startsWith("pull failed")) {
    return pullResult;
  }

  // Migration runs only after a successful pull — never on stale local state.
  await runSyncMigrations(config, syncRepoDir);
  return pullResult;
}

/**
 * Attempt rebase-first pull with fallback to merge, both with markdown
 * conflict auto-resolution. Extracted so syncPull can cleanly run migration
 * after any success path.
 */
async function pullWithConflictResolution(
  syncRepoDir: string,
  remoteBranch: string,
): Promise<string> {
  try {
    await git(["rebase", remoteBranch], syncRepoDir);
    return "pulled successfully";
  } catch {
    const resolved = await resolveConflicts(syncRepoDir);

    if (resolved.length > 0) {
      try {
        await git(["rebase", "--continue"], syncRepoDir);
        process.stderr.write(`memex[sync]: auto-resolved conflicts in ${resolved.join(", ")}\n`);
        return `pulled with auto-resolved conflicts: ${resolved.join(", ")}`;
      } catch {
        await git(["rebase", "--abort"], syncRepoDir);
      }
    } else {
      await git(["rebase", "--abort"], syncRepoDir);
    }

    try {
      await git(["merge", remoteBranch, "--no-edit"], syncRepoDir);
      return "pulled (merge)";
    } catch {
      const mergeResolved = await resolveConflicts(syncRepoDir);
      if (mergeResolved.length > 0) {
        await git(["commit", "--no-edit", "-m", "Auto-resolve merge conflicts"], syncRepoDir);
        return `pulled with merge + auto-resolved: ${mergeResolved.join(", ")}`;
      }
      try {
        await git(["merge", "--abort"], syncRepoDir);
      } catch {
        /* already clean */
      }
      return "pull failed: unresolvable conflicts";
    }
  }
}
```

- [ ] **Step 3: Build + run all tests**

Run: `npx tsc --noEmit && npx vitest run`
Expected: build clean, all existing tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/sync.ts
git commit -m "feat(sync): wire runSyncMigrations into syncPull

Migration runs at three positions: no-remote local-only path, no-commits
fresh repo path, and after a successful rebase/merge. Never on stale
pre-fetch state. Extracted pullWithConflictResolution helper to keep
syncPull readable."
```

---

## Task 11: Export migration API from `src/index.ts`

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 1: Add the exports**

Append to `src/index.ts`:

```typescript
export {
  migrateProjectIdsToLowercase,
  readSyncRepoVersion,
  runSyncMigrations,
  writeSyncRepoVersion,
} from "./sync-migration.js";
export type { MigrationResult } from "./sync-migration.js";
```

Only the public API surface is re-exported. `mergeMarkdownBodies` and `isMidRebaseOrMerge` remain internal to `sync-migration.ts` — tests import them directly from the module, not via the index.

- [ ] **Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Verify all tests still pass**

Run: `npx vitest run`
Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/index.ts
git commit -m "feat(index): export sync-migration public API

runSyncMigrations and migrateProjectIdsToLowercase are exported so
platform CLIs (memex doctor, etc.) can invoke migration directly."
```

---

## Task 12: Multi-device race integration test

**Files:**
- Modify: `test/sync-migration.test.ts`

This is the final correctness check for the systems-review CRITICAL finding about device races. Simulates two clones of a shared bare remote, verifies that one device's migration propagates cleanly to the other.

- [ ] **Step 1: Write the integration test**

Append to `test/sync-migration.test.ts`:

```typescript
import { syncPull } from "../src/sync.ts";

describe("multi-device race - runSyncMigrations via syncPull", () => {
  let bareRemote: string;
  let deviceA: string;
  let deviceB: string;

  beforeEach(async () => {
    bareRemote = await mkdtemp(join(tmpdir(), "memex-bare-"));
    deviceA = await mkdtemp(join(tmpdir(), "memex-devA-"));
    deviceB = await mkdtemp(join(tmpdir(), "memex-devB-"));

    await runGit(["init", "--bare", "--initial-branch=main"], bareRemote);

    // Seed the bare remote with legacy mixed-case content from a throwaway clone
    const seeder = await mkdtemp(join(tmpdir(), "memex-seed-"));
    // Run clone from tmpdir() so we're not spawning git inside the memex-core
    // working tree. The dst path is absolute so cwd doesn't affect the result.
    await runGit(["clone", bareRemote, seeder], tmpdir());
    await runGit(["config", "user.email", "seed@memex.local"], seeder);
    await runGit(["config", "user.name", "Seed"], seeder);
    const seedFile = join(seeder, "projects/GitHub.com/Jim80Net/Repo/memory/notes.md");
    await mkdir(join(seedFile, ".."), { recursive: true });
    await writeFile(seedFile, "seeded legacy", "utf-8");
    await runGit(["add", "-A"], seeder);
    await runGit(["commit", "-m", "seed legacy content"], seeder);
    await runGit(["push", "origin", "main"], seeder);
    await rm(seeder, { recursive: true, force: true });
  });

  afterEach(async () => {
    await rm(bareRemote, { recursive: true, force: true });
    await rm(deviceA, { recursive: true, force: true });
    await rm(deviceB, { recursive: true, force: true });
  });

  it("first device migrates, second device sees v2 marker and skips", async () => {
    const config: SyncConfig = {
      ...baseSyncConfig,
      enabled: true,
      repo: bareRemote,
    };

    // Device A: initial sync triggers clone + migration + push
    const resultA = await syncPull(config, deviceA);
    expect(resultA).toContain("pulled");
    expect(await readSyncRepoVersion(deviceA)).toBe(2);

    // Push A's migration commit to the bare remote
    await runGit(["push", "origin", "main"], deviceA);

    // Device B: initial sync clones the already-migrated tree
    const resultB = await syncPull(config, deviceB);
    expect(resultB).toContain("pulled");
    expect(await readSyncRepoVersion(deviceB)).toBe(2);

    // Both devices should have the lowercase tree
    await expect(
      stat(join(deviceA, "projects/github.com/jim80net/repo/memory/notes.md")),
    ).resolves.toBeDefined();
    await expect(
      stat(join(deviceB, "projects/github.com/jim80net/repo/memory/notes.md")),
    ).resolves.toBeDefined();

    // Device B should NOT have created its own migration commit
    const { stdout: aLog } = await runGit(["log", "--oneline"], deviceA);
    const { stdout: bLog } = await runGit(["log", "--oneline"], deviceB);
    const aMigrationCount = (aLog.match(/migrate project IDs/g) ?? []).length;
    const bMigrationCount = (bLog.match(/migrate project IDs/g) ?? []).length;
    expect(aMigrationCount).toBe(1);
    expect(bMigrationCount).toBe(1); // only the one from A that B pulled
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `npx vitest run test/sync-migration.test.ts -t "multi-device race"`
Expected: test passes. Both devices end on v2 with a single migration commit in the shared history.

- [ ] **Step 3: Run the full test suite once more**

Run: `npx vitest run`
Expected: every test passes.

- [ ] **Step 4: Commit**

```bash
git add test/sync-migration.test.ts
git commit -m "test(sync-migration): multi-device race integration test

Simulates two clones of a shared bare remote. First device clones,
migrates, pushes. Second device clones the post-migration tip, sees
v2 marker, skips migration. Verifies no divergent migration commits."
```

---

## Task 13: Update README and CHANGELOG

**Files:**
- Modify: `README.md`
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Read existing README.md**

Run: `cat README.md | head -60`
Scan for the section that documents `SyncConfig` fields (if any) so the new field can be added next to the existing ones.

- [ ] **Step 2: Add `caseSensitive` documentation**

Add a subsection under the existing Sync documentation in `README.md`:

```markdown
### Case-insensitive project IDs (default)

Project IDs are lowercased by default across all three resolution paths
(manual mappings, git remote URLs, and encoded `_local/` path fallbacks).
A clone of `git@github.com:Jim80Net/Repo.git` and `git@github.com:jim80net/repo.git`
now map to the same canonical id: `github.com/jim80net/repo`.

To preserve the original case, set `caseSensitive: true` in your sync config:

```typescript
const syncConfig: SyncConfig = {
  enabled: true,
  repo: "git@github.com:me/memex-sync.git",
  autoPull: true,
  autoCommitPush: true,
  projectMappings: {},
  caseSensitive: true, // preserve case as-is
};
```

On first sync after upgrading from a version that wrote mixed-case directories,
`syncPull` will run a one-shot migration that renames legacy paths to lowercase
and writes a `.memex-sync/version.json` marker so the scan only runs once. The
migration is safe across devices (only runs against post-pull state), idempotent,
and handles case-insensitive filesystems (macOS APFS, Windows NTFS) correctly.
```

- [ ] **Step 3: Add CHANGELOG entry**

Add a new unreleased section at the top of `CHANGELOG.md`:

```markdown
## Unreleased

### Added
- `SyncConfig.caseSensitive` optional flag (default `false`) controlling
  case handling in `resolveProjectId`. Project IDs are now lowercased by
  default across all three resolution paths.
- `runSyncMigrations` and `migrateProjectIdsToLowercase` exported from
  the public API for CLI diagnostics.
- One-shot migration of existing mixed-case sync repo contents, gated by
  a new `.memex-sync/version.json` schema marker. Runs automatically on
  first `syncPull` after upgrade.
- Case-insensitive fallback in `findMatchingProjectMemoryDirs` to cover
  the rollout window between library upgrade and first post-upgrade sync.

### Changed
- `normalizeGitUrl` now accepts an optional `caseSensitive` parameter and
  lowercases its output by default. Existing call sites with preserved
  case behavior need to pass `true` explicitly.
- Git helper functions extracted from `src/sync.ts` into a new internal
  `src/git-helpers.ts` module (no API change).
```

- [ ] **Step 4: Commit**

```bash
git add README.md CHANGELOG.md
git commit -m "docs: document caseSensitive flag and lowercase migration

README gains a subsection on the new default case-insensitive routing
and the opt-out flag. CHANGELOG records the additive schema change."
```

---

## Final verification

- [ ] **Run the full test suite one more time**

Run: `npx vitest run`
Expected: every test across every file passes.

- [ ] **Run the build**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Verify no unintended file changes**

Run: `git status`
Expected: clean working tree (all tasks committed).

- [ ] **Run gitnexus detect_changes per CLAUDE.md**

Run the `gitnexus_detect_changes({scope: "compare", base_ref: "main"})` MCP tool.
Expected: only files listed in the "Modified files" table at the top of this plan appear in the diff.

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { syncPull } from "../src/sync.ts";
import {
  isMidRebaseOrMerge,
  mergeMarkdownBodies,
  migrateProjectIdsToLowercase,
  readSyncRepoVersion,
  runSyncMigrations,
  writeSyncRepoVersion,
} from "../src/sync-migration.ts";
import type { SyncConfig } from "../src/types.ts";

// Ensure git has an author identity on CI runners (which may have no
// global config). Applies to every git subprocess spawned from this
// test file via the execFile-based `git` helper.
process.env.GIT_AUTHOR_NAME ??= "Memex Test";
process.env.GIT_AUTHOR_EMAIL ??= "test@memex.local";
process.env.GIT_COMMITTER_NAME ??= "Memex Test";
process.env.GIT_COMMITTER_EMAIL ??= "test@memex.local";

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

    expect(new Set(result.renamed)).toEqual(new Set(["Host/OwnerA/RepoA", "Host/OwnerB/RepoB"]));

    await expect(
      stat(join(repoDir, "projects/host/ownera/repoa/memory/a.md")),
    ).resolves.toBeDefined();
    await expect(
      stat(join(repoDir, "projects/host/ownerb/repob/memory/b.md")),
    ).resolves.toBeDefined();
  });
});

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

    const result = await runSyncMigrations({ ...baseSyncConfig, caseSensitive: true }, repoDir);

    expect(result).toContain("case-sensitive");
    // Legacy path is untouched
    await expect(
      stat(join(repoDir, "projects/GitHub.com/foo/bar/memory/notes.md")),
    ).resolves.toBeDefined();
    expect(await readSyncRepoVersion(repoDir)).toBe(1);
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

  it("device B pulls migration commit and skips its own", async () => {
    const config: SyncConfig = {
      ...baseSyncConfig,
      enabled: true,
      repo: bareRemote,
    };

    // Both devices clone FIRST (before either has migrated).
    // initSyncRepo inside syncPull does the clone, so we call it but
    // ignore the migration it would trigger by setting caseSensitive=true
    // temporarily — actually, we want A to NOT migrate yet. The cleanest
    // way is to clone manually via the CLI before either syncPull runs.
    await runGit(["clone", bareRemote, deviceA], tmpdir());
    await runGit(["config", "user.email", "a@memex.local"], deviceA);
    await runGit(["config", "user.name", "Device A"], deviceA);

    await runGit(["clone", bareRemote, deviceB], tmpdir());
    await runGit(["config", "user.email", "b@memex.local"], deviceB);
    await runGit(["config", "user.name", "Device B"], deviceB);

    // Both devices now have the legacy mixed-case content locally.
    await expect(
      stat(join(deviceA, "projects/GitHub.com/Jim80Net/Repo/memory/notes.md")),
    ).resolves.toBeDefined();
    await expect(
      stat(join(deviceB, "projects/GitHub.com/Jim80Net/Repo/memory/notes.md")),
    ).resolves.toBeDefined();

    // Device A runs syncPull: fetch (no-op, already up-to-date) → migration runs → commit
    const resultA = await syncPull(config, deviceA);
    expect(resultA).toContain("pulled");
    expect(await readSyncRepoVersion(deviceA)).toBe(2);

    // A pushes its migration commit
    await runGit(["push", "origin", "main"], deviceA);

    // Device B runs syncPull: fetch brings A's migration commit → rebase/merge
    // applies it → runSyncMigrations sees v2 marker → skips
    const resultB = await syncPull(config, deviceB);
    expect(resultB).toContain("pulled");
    expect(await readSyncRepoVersion(deviceB)).toBe(2);

    // B should have the lowercase tree (via A's migration commit pulled in)
    await expect(
      stat(join(deviceB, "projects/github.com/jim80net/repo/memory/notes.md")),
    ).resolves.toBeDefined();

    // Exactly one migration commit in each device's history
    const { stdout: aLog2 } = await runGit(["log", "--oneline"], deviceA);
    const { stdout: bLog2 } = await runGit(["log", "--oneline"], deviceB);
    expect((aLog2.match(/migrate project IDs/g) ?? []).length).toBe(1);
    expect((bLog2.match(/migrate project IDs/g) ?? []).length).toBe(1);
  });
});

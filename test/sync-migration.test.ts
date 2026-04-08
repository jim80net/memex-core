import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isMidRebaseOrMerge,
  mergeMarkdownBodies,
  migrateProjectIdsToLowercase,
  readSyncRepoVersion,
  writeSyncRepoVersion,
} from "../src/sync-migration.ts";

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

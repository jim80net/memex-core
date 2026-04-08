import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isMidRebaseOrMerge,
  mergeMarkdownBodies,
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

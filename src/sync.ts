import { execFile } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { getDefaultBranch, git, hasCommits, hasRemote, isGitRepo } from "./git-helpers.js";
import { getSyncProjectMemoryDir } from "./project-mapping.js";
import { runSyncMigrations } from "./sync-migration.js";
import type { SyncConfig } from "./types.js";

const execFileAsync = promisify(execFile);

// ---------------------------------------------------------------------------
// Conflict resolution
// ---------------------------------------------------------------------------

/**
 * Auto-resolve merge conflicts in markdown files by keeping both sides.
 */
export function autoResolveMarkdownConflict(content: string): string {
  const conflictPattern = /^<{7}\s.*\n([\s\S]*?)^={7}\n([\s\S]*?)^>{7}\s.*$/gm;

  return content.replace(conflictPattern, (_match, ours: string, theirs: string) => {
    const oursTrimmed = ours.trim();
    const theirsTrimmed = theirs.trim();

    if (oursTrimmed === theirsTrimmed) return oursTrimmed;

    return `${oursTrimmed}\n\n${theirsTrimmed}`;
  });
}

async function resolveConflicts(repoDir: string): Promise<string[]> {
  const { stdout } = await git(["diff", "--name-only", "--diff-filter=U"], repoDir);
  const conflictedFiles = stdout.trim().split("\n").filter(Boolean);
  const resolved: string[] = [];

  for (const file of conflictedFiles) {
    const filePath = join(repoDir, file);
    if (!file.endsWith(".md")) {
      await git(["checkout", "--theirs", file], repoDir);
      await git(["add", file], repoDir);
      resolved.push(file);
      continue;
    }

    try {
      const content = await readFile(filePath, "utf-8");
      const merged = autoResolveMarkdownConflict(content);
      await writeFile(filePath, merged, "utf-8");
      await git(["add", file], repoDir);
      resolved.push(file);
    } catch {
      try {
        await git(["checkout", "--theirs", file], repoDir);
        await git(["add", file], repoDir);
        resolved.push(file);
      } catch {
        // skip
      }
    }
  }

  return resolved;
}

// ---------------------------------------------------------------------------
// Core sync operations
// ---------------------------------------------------------------------------

export async function initSyncRepo(config: SyncConfig, syncRepoDir: string): Promise<void> {
  if (!config.enabled || !config.repo) return;

  await mkdir(syncRepoDir, { recursive: true });

  if (await isGitRepo(syncRepoDir)) {
    try {
      const { stdout } = await git(["remote", "get-url", "origin"], syncRepoDir);
      if (stdout.trim() !== config.repo) {
        await git(["remote", "set-url", "origin", config.repo], syncRepoDir);
        process.stderr.write(`memex[sync]: updated remote to ${config.repo}\n`);
      }
    } catch {
      await git(["remote", "add", "origin", config.repo], syncRepoDir);
    }
    return;
  }

  try {
    await execFileAsync("git", ["clone", config.repo, syncRepoDir], { timeout: 60_000 });
    process.stderr.write(`memex[sync]: cloned ${config.repo}\n`);
  } catch {
    await git(["init"], syncRepoDir);
    await git(["remote", "add", "origin", config.repo], syncRepoDir);
    process.stderr.write(`memex[sync]: initialized new repo with remote ${config.repo}\n`);
  }
}

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

/**
 * Collect local changes from source directories and copy them into the sync repo.
 * Then commit and push.
 *
 * @param sourceDirs - Platform-specific source directories to sync FROM
 */
export async function syncCommitAndPush(
  config: SyncConfig,
  syncRepoDir: string,
  sourceDirs: { rules: string; skills: string; projectMemoryDir: string },
  cwd: string,
): Promise<string> {
  if (!config.enabled || !config.repo) return "sync disabled";

  await initSyncRepo(config, syncRepoDir);

  let changeCount = 0;

  // Sync rules
  changeCount += await syncDirectory(sourceDirs.rules, join(syncRepoDir, "rules"), "*.md");

  // Sync skills
  changeCount += await syncSkillsDirectory(sourceDirs.skills, join(syncRepoDir, "skills"));

  // Sync project memories
  const syncMemoryDir = await getSyncProjectMemoryDir(cwd, syncRepoDir, config);
  changeCount += await syncDirectory(sourceDirs.projectMemoryDir, syncMemoryDir, "*.md");

  if (changeCount === 0) return "no changes to sync";

  try {
    await git(["add", "-A"], syncRepoDir);
    const { stdout: statusOut } = await git(["status", "--porcelain"], syncRepoDir);
    if (!statusOut.trim()) return "no changes after staging";

    const hostname = (await execFileAsync("hostname", [], { timeout: 5000 })).stdout.trim();
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const message = `sync from ${hostname} at ${timestamp}`;

    await git(["commit", "-m", message], syncRepoDir);
    process.stderr.write(`memex[sync]: committed ${changeCount} file(s)\n`);
  } catch (err) {
    return `commit failed: ${err}`;
  }

  if (!(await hasRemote(syncRepoDir))) return "committed (no remote)";

  const pushBranch = await getDefaultBranch(syncRepoDir);
  try {
    try {
      await git(["push"], syncRepoDir);
    } catch {
      await git(["push", "-u", "origin", pushBranch], syncRepoDir);
    }
    process.stderr.write(`memex[sync]: pushed to remote\n`);
    return `synced ${changeCount} file(s)`;
  } catch (err) {
    process.stderr.write(`memex[sync]: push failed: ${err}\n`);
    return `committed locally, push failed: ${err}`;
  }
}

// ---------------------------------------------------------------------------
// File sync helpers
// ---------------------------------------------------------------------------

async function syncDirectory(srcDir: string, destDir: string, pattern: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return 0;
  }

  const ext = pattern.replace("*", "");
  const filtered = entries.filter((e) => e.endsWith(ext));
  let copied = 0;

  for (const entry of filtered) {
    const srcPath = join(srcDir, entry);
    const destPath = join(destDir, entry);

    try {
      const srcStat = await stat(srcPath);
      if (!srcStat.isFile()) continue;

      let needsCopy = false;
      try {
        const destStat = await stat(destPath);
        needsCopy = srcStat.mtimeMs > destStat.mtimeMs;
      } catch {
        needsCopy = true;
      }

      if (needsCopy) {
        await mkdir(destDir, { recursive: true });
        const content = await readFile(srcPath, "utf-8");
        await writeFile(destPath, content, "utf-8");
        copied++;
      }
    } catch {
      // skip unreadable files
    }
  }

  return copied;
}

async function syncSkillsDirectory(srcDir: string, destDir: string): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(srcDir);
  } catch {
    return 0;
  }

  let copied = 0;

  for (const entry of entries) {
    const srcSkillMd = join(srcDir, entry, "SKILL.md");
    const destSkillMd = join(destDir, entry, "SKILL.md");

    try {
      const srcStat = await stat(srcSkillMd);
      if (!srcStat.isFile()) continue;

      let needsCopy = false;
      try {
        const destStat = await stat(destSkillMd);
        needsCopy = srcStat.mtimeMs > destStat.mtimeMs;
      } catch {
        needsCopy = true;
      }

      if (needsCopy) {
        await mkdir(join(destDir, entry), { recursive: true });
        const content = await readFile(srcSkillMd, "utf-8");
        await writeFile(destSkillMd, content, "utf-8");
        copied++;
      }
    } catch {
      // skip
    }
  }

  return copied;
}

export function getSyncScanDirs(syncRepoPath: string): {
  rulesDir: string;
  skillsDir: string;
} {
  return {
    rulesDir: join(syncRepoPath, "rules"),
    skillsDir: join(syncRepoPath, "skills"),
  };
}

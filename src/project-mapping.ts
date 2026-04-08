import { execFile } from "node:child_process";
import { readdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { encodeProjectPath } from "./path-encoder.js";
import type { SyncConfig } from "./types.js";

const execFileAsync = promisify(execFile);

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

/**
 * Get the git remote origin URL for a directory, if it's a git repo.
 */
async function getGitRemoteUrl(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], {
      cwd,
      timeout: 5000,
    });
    const url = stdout.trim();
    return url || null;
  } catch {
    return null;
  }
}

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

/**
 * Get the sync repo's memory directory path for the canonical project ID.
 */
export async function getSyncProjectMemoryDir(
  cwd: string,
  syncRepoPath: string,
  syncConfig: SyncConfig,
): Promise<string> {
  const canonicalId = await resolveProjectId(cwd, syncConfig);
  return join(syncRepoPath, "projects", canonicalId, "memory");
}

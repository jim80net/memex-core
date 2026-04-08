import { execFile } from "node:child_process";
import { stat } from "node:fs/promises";
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
 * Multiple matches are possible (e.g., same project stored under both URL and encoded path).
 */
export async function findMatchingProjectMemoryDirs(
  cwd: string,
  syncRepoPath: string,
  syncConfig: SyncConfig,
): Promise<string[]> {
  const projectsDir = join(syncRepoPath, "projects");
  const matches: string[] = [];

  const canonicalId = await resolveProjectId(cwd, syncConfig);
  const canonicalMemDir = join(projectsDir, canonicalId, "memory");
  try {
    await stat(canonicalMemDir);
    matches.push(canonicalMemDir);
  } catch {
    // doesn't exist yet
  }

  const encodedPath = encodeProjectPath(cwd);
  const localMemDir = join(projectsDir, "_local", encodedPath, "memory");
  if (localMemDir !== canonicalMemDir) {
    try {
      await stat(localMemDir);
      matches.push(localMemDir);
    } catch {
      // doesn't exist
    }
  }

  return matches;
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

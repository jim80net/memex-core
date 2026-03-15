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
 * Examples:
 *   git@github.com:jim80net/repo.git → github.com/jim80net/repo
 *   https://github.com/jim80net/repo.git → github.com/jim80net/repo
 */
export function normalizeGitUrl(url: string): string {
  let normalized = url.trim();

  // Strip trailing .git
  normalized = normalized.replace(/\.git$/, "");

  // SSH format: git@host:owner/repo
  const sshMatch = normalized.match(/^[\w-]+@([^:]+):(.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }

  // HTTPS format: https://host/owner/repo
  try {
    const parsed = new URL(normalized);
    return `${parsed.host}${parsed.pathname}`.replace(/^\//, "").replace(/\/$/, "");
  } catch {
    return normalized;
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
 */
export async function resolveProjectId(cwd: string, syncConfig: SyncConfig): Promise<string> {
  // 1. Manual mapping
  if (syncConfig.projectMappings[cwd]) {
    return syncConfig.projectMappings[cwd];
  }

  // 2. Git remote URL
  const remoteUrl = await getGitRemoteUrl(cwd);
  if (remoteUrl) {
    return normalizeGitUrl(remoteUrl);
  }

  // 3. Encoded path fallback
  return `_local/${encodeProjectPath(cwd)}`;
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

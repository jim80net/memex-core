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

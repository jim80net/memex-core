import { mkdir, readdir, readFile, rm, rmdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { git, hasCommits } from "./git-helpers.js";
import type { SyncConfig } from "./types.js";

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
async function removeEmptyLegacyAncestors(syncRepoDir: string, srcRelative: string): Promise<void> {
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
      await rmdir(current);
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
export async function migrateProjectIdsToLowercase(syncRepoDir: string): Promise<MigrationResult> {
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
      await mergeProjectDirs(syncRepoDir, srcRelative, dstRelative);
      merged.push(src);
      continue;
    }

    await gitRenameCaseOnly(syncRepoDir, srcRelative, dstRelative);
    await removeEmptyLegacyAncestors(syncRepoDir, srcRelative);
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
      const mergedBody = mergeMarkdownBodies(srcBody, dstBody);
      await writeFile(dstFileAbs, mergedBody, "utf-8");
      await git(["add", dstFileRel], syncRepoDir);
      await git(["rm", srcFileRel], syncRepoDir);
    } else {
      const [srcStatRes, dstStatRes] = await Promise.all([stat(srcFileAbs), stat(dstFileAbs)]);
      if (srcStatRes.mtimeMs > dstStatRes.mtimeMs) {
        // src is newer — replace dst with src content
        const content = await readFile(srcFileAbs);
        await writeFile(dstFileAbs, content);
        await git(["add", dstFileRel], syncRepoDir);
      }
      // either way, remove src
      await git(["rm", srcFileRel], syncRepoDir);
    }
  }

  // All tracked files have been git-removed or moved; the src directory tree
  // is now empty and untracked — remove the remaining inode with plain fs.rm.
  await rm(join(syncRepoDir, srcRelative), { recursive: true, force: true });
}

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
 * devices. See `openspec/changes/lowercase-project-ids/design.md`
 * section 4.
 */
export async function runSyncMigrations(config: SyncConfig, syncRepoDir: string): Promise<string> {
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

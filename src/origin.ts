/**
 * Shared origin root resolution, symlink projection, and materialize writes.
 *
 * Design: design/shared-origin-sync-profile.md (XO-gated 2026-07-10).
 * Locked: ~/.memex default + resolver; absolute symlinks v1; partial apply
 * + report conflicts; one-release memex-claude → ~/.memex compat symlink.
 */

import {
  lstat,
  mkdir,
  readdir,
  readFile,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { withFileLock } from "./file-lock.js";
import { git, isGitRepo } from "./git-helpers.js";
import { parseEntryLifecycle } from "./lifecycle.js";
import type {
  MaterializeInput,
  MaterializeResult,
  ProjectConflict,
  ProjectionTarget,
  ProjectLinkPlan,
  ProjectPlan,
  ProjectRemovalPlan,
} from "./types.js";

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

const ENV_ORIGIN = "MEMEX_ORIGIN";

export type OriginRootSource = "explicit" | "env" | "default" | "xdg" | "legacy-claude";

export type ResolveOriginRootOptions = {
  /** Explicit root from profile.origin.root (absolute or ~/…). */
  root?: string;
  /** Override homedir (tests). */
  homeDir?: string;
  /** Override process.env (tests). */
  env?: NodeJS.ProcessEnv;
  /**
   * When nothing exists on disk, still return the product default path
   * (`~/.memex`). Default true.
   */
  preferDefaultWhenMissing?: boolean;
};

export type ResolvedOriginRoot = {
  root: string;
  source: OriginRootSource;
  /** Whether the resolved path currently exists. */
  exists: boolean;
};

/**
 * Expand `~/…` against homeDir; leave other paths for resolve().
 */
export function expandUserPath(path: string, homeDir: string): string {
  if (path === "~") return homeDir;
  if (path.startsWith(`~/`) || path.startsWith(`~${sep}`)) {
    return join(homeDir, path.slice(2));
  }
  return path;
}

/**
 * Resolve to an absolute path. Rejects empty input.
 */
export function toAbsolutePath(path: string, homeDir: string): string {
  const expanded = expandUserPath(path.trim(), homeDir);
  if (!expanded) {
    throw new Error("path must be non-empty");
  }
  return resolve(expanded);
}

/**
 * True when `candidate` is exactly `root` or a path under `root`
 * (after resolve). Does not follow symlinks on the inputs.
 */
export function isPathInsideRoot(root: string, candidate: string): boolean {
  const r = resolve(root);
  const c = resolve(candidate);
  if (c === r) return true;
  const prefix = r.endsWith(sep) ? r : r + sep;
  return c.startsWith(prefix);
}

/**
 * Join origin root + relative path with traversal rejection.
 * `relPath` must not be absolute and must stay under root.
 */
export function resolveUnderOrigin(originRoot: string, relPath: string): string {
  const root = resolve(originRoot);
  const cleaned = relPath.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned || cleaned === ".") {
    throw new Error(`origin-relative path must be non-empty: ${JSON.stringify(relPath)}`);
  }
  if (isAbsolute(relPath) || isAbsolute(cleaned)) {
    throw new Error(`origin-relative path must not be absolute: ${JSON.stringify(relPath)}`);
  }
  const abs = resolve(root, cleaned);
  if (!isPathInsideRoot(root, abs)) {
    throw new Error(`path escapes origin root: ${JSON.stringify(relPath)}`);
  }
  return abs;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// resolveOriginRoot
// ---------------------------------------------------------------------------

/**
 * Resolve the shared origin root.
 *
 * Precedence (XO-locked):
 * 1. explicit `opts.root`
 * 2. env `MEMEX_ORIGIN`
 * 3. existing `~/.memex`
 * 4. existing `~/.local/share/memex` (XDG / historical grok default)
 * 5. existing `~/.local/share/memex-claude` (legacy live corpus)
 * 6. product default `~/.memex` (may not exist yet)
 */
export async function resolveOriginRoot(
  opts: ResolveOriginRootOptions = {},
): Promise<ResolvedOriginRoot> {
  const home = opts.homeDir ?? homedir();
  const env = opts.env ?? process.env;
  const preferDefault = opts.preferDefaultWhenMissing !== false;

  const defaultRoot = join(home, ".memex");
  const xdgRoot = join(home, ".local", "share", "memex");
  const legacyClaude = join(home, ".local", "share", "memex-claude");

  if (opts.root !== undefined && opts.root.trim() !== "") {
    const root = toAbsolutePath(opts.root, home);
    return { root, source: "explicit", exists: await pathExists(root) };
  }

  const envVal = env[ENV_ORIGIN];
  if (typeof envVal === "string" && envVal.trim() !== "") {
    const root = toAbsolutePath(envVal, home);
    return { root, source: "env", exists: await pathExists(root) };
  }

  if (await pathExists(defaultRoot)) {
    return { root: resolve(defaultRoot), source: "default", exists: true };
  }
  if (await pathExists(xdgRoot)) {
    return { root: resolve(xdgRoot), source: "xdg", exists: true };
  }
  if (await pathExists(legacyClaude)) {
    return { root: resolve(legacyClaude), source: "legacy-claude", exists: true };
  }

  if (preferDefault) {
    return { root: resolve(defaultRoot), source: "default", exists: false };
  }

  return { root: resolve(defaultRoot), source: "default", exists: false };
}

/** Product-default origin path for a given home (does not touch the filesystem). */
export function defaultOriginRoot(homeDir: string = homedir()): string {
  return resolve(join(homeDir, ".memex"));
}

/** Legacy claude corpus path (compat / migrate source). */
export function legacyClaudeOriginRoot(homeDir: string = homedir()): string {
  return resolve(join(homeDir, ".local", "share", "memex-claude"));
}

// ---------------------------------------------------------------------------
// planProjection / applyProjection
// ---------------------------------------------------------------------------

export type PlanProjectionOptions = {
  /** Default true — replace managed symlinks that point under origin. */
  relinkManaged?: boolean;
};

function patternToSuffix(pattern: string | undefined): string {
  // v1: only support "*.ext" style → suffix match
  const p = pattern ?? "*.md";
  if (p.startsWith("*")) return p.slice(1);
  return p;
}

async function listFileEntries(
  originDir: string,
  suffix: string,
): Promise<{ name: string; absPath: string }[]> {
  let names: string[];
  try {
    names = await readdir(originDir);
  } catch {
    return [];
  }
  const out: { name: string; absPath: string }[] = [];
  for (const name of names) {
    if (!name.endsWith(suffix)) continue;
    const absPath = join(originDir, name);
    try {
      const st = await lstat(absPath);
      // Follow only for type check of the origin entry itself if it's a link? Origin
      // entries should be real files. Accept regular files; skip dirs/symlinks-to-dirs.
      if (st.isFile() || (st.isSymbolicLink() && (await isSymlinkToFile(absPath)))) {
        out.push({ name, absPath: resolve(absPath) });
      }
    } catch {
      // skip
    }
  }
  return out;
}

async function isSymlinkToFile(path: string): Promise<boolean> {
  try {
    const st = await lstat(await realpath(path));
    return st.isFile();
  } catch {
    return false;
  }
}

async function listSkillDirEntries(
  originDir: string,
): Promise<{ name: string; absPath: string }[]> {
  let names: string[];
  try {
    names = await readdir(originDir);
  } catch {
    return [];
  }
  const out: { name: string; absPath: string }[] = [];
  for (const name of names) {
    const skillDir = join(originDir, name);
    const skillMd = join(skillDir, "SKILL.md");
    try {
      const dirStat = await lstat(skillDir);
      if (!dirStat.isDirectory() && !dirStat.isSymbolicLink()) continue;
      const mdStat = await lstat(skillMd);
      if (!mdStat.isFile() && !mdStat.isSymbolicLink()) continue;
      out.push({ name, absPath: resolve(skillDir) });
    } catch {
      // skip
    }
  }
  return out;
}

/**
 * Classify existing target path for projection planning.
 * Uses lstat (does not follow the final target symlink for type).
 */
async function classifyTarget(
  targetPath: string,
  originPath: string,
  originRoot: string,
  relinkManaged: boolean,
): Promise<"create" | "noop" | "relink" | ProjectConflict["reason"]> {
  let st: Awaited<ReturnType<typeof lstat>>;
  try {
    st = await lstat(targetPath);
  } catch {
    return "create";
  }

  if (st.isSymbolicLink()) {
    let linkTarget: string;
    try {
      linkTarget = await readlink(targetPath);
    } catch {
      return "broken-unmanaged";
    }

    // Normalize link target to absolute for comparison (v1 uses absolute links).
    const absLink = isAbsolute(linkTarget)
      ? resolve(linkTarget)
      : resolve(dirname(targetPath), linkTarget);

    const originAbs = resolve(originPath);

    // Same destination (string or realpath when both exist)
    if (absLink === originAbs) return "noop";
    try {
      const [a, b] = await Promise.all([realpath(targetPath), realpath(originPath)]);
      if (a === b) return "noop";
    } catch {
      // broken or missing origin — fall through
    }

    if (isPathInsideRoot(originRoot, absLink)) {
      return relinkManaged ? "relink" : "foreign-symlink";
    }

    // Broken symlink: only relink if the *link text* was under origin
    try {
      await realpath(targetPath);
      // resolved outside origin
      return "foreign-symlink";
    } catch {
      if (relinkManaged && isPathInsideRoot(originRoot, absLink)) {
        return "relink";
      }
      return "broken-unmanaged";
    }
  }

  if (st.isDirectory()) return "real-dir";
  if (st.isFile()) return "real-file";
  return "type-mismatch";
}

async function isExactManagedSymlink(targetPath: string, originPath: string): Promise<boolean> {
  try {
    const st = await lstat(targetPath);
    if (!st.isSymbolicLink()) return false;
    const linkTarget = await readlink(targetPath);
    const absoluteTarget = isAbsolute(linkTarget)
      ? resolve(linkTarget)
      : resolve(dirname(targetPath), linkTarget);
    return absoluteTarget === resolve(originPath);
  } catch {
    return false;
  }
}

/**
 * Build a projection plan: which dirs to ensure, which links to create/relink/noop,
 * and which paths conflict (fail-closed — never clobber real files).
 */
export async function planProjection(
  originRoot: string,
  targets: ProjectionTarget[],
  opts: PlanProjectionOptions = {},
): Promise<ProjectPlan> {
  const root = resolve(originRoot);
  const relinkManaged = opts.relinkManaged !== false;
  const ensureDirs = new Set<string>();
  const links: ProjectLinkPlan[] = [];
  const removals: ProjectRemovalPlan[] = [];
  const conflicts: ProjectConflict[] = [];

  for (const target of targets) {
    const targetDir = resolve(target.targetDir);
    const originDir = resolveUnderOrigin(root, target.originRelDir);
    const initDir = target.initTargetDir !== false;
    if (initDir) ensureDirs.add(targetDir);

    const entries =
      target.entryKind === "skill-dirs"
        ? await listSkillDirEntries(originDir)
        : await listFileEntries(originDir, patternToSuffix(target.pattern));

    for (const entry of entries) {
      const targetPath = join(targetDir, entry.name);
      const originPath = entry.absPath;
      if (!isPathInsideRoot(root, originPath)) {
        conflicts.push({
          targetPath,
          originPath,
          reason: "type-mismatch",
        });
        continue;
      }

      const markdownPath =
        target.entryKind === "skill-dirs" ? join(originPath, "SKILL.md") : originPath;
      let retired: boolean;
      try {
        retired = parseEntryLifecycle(await readFile(markdownPath, "utf-8")) === "retired";
      } catch {
        conflicts.push({ targetPath, originPath, reason: "lifecycle-read-error" });
        continue;
      }

      const decision = await classifyTarget(targetPath, originPath, root, relinkManaged);
      if (retired) {
        if (decision === "noop") {
          if (await isExactManagedSymlink(targetPath, originPath)) {
            removals.push({ targetPath, originPath });
          } else {
            conflicts.push({ targetPath, originPath, reason: "changed-managed-symlink" });
          }
        } else if (decision === "relink") {
          conflicts.push({ targetPath, originPath, reason: "changed-managed-symlink" });
        } else if (decision !== "create") {
          conflicts.push({ targetPath, originPath, reason: decision });
        }
        continue;
      }
      if (decision === "create" || decision === "relink" || decision === "noop") {
        links.push({ targetPath, originPath, action: decision });
      } else {
        conflicts.push({ targetPath, originPath, reason: decision });
      }
    }
  }

  return {
    ensureDirs: [...ensureDirs].sort(),
    links,
    removals,
    conflicts,
  };
}

export type ApplyProjectionOptions = {
  /** v1: only "fail-closed" — conflicts are never applied. */
  onClobber?: "fail-closed";
};

export type ApplyProjectionResult = {
  linked: number;
  removed: number;
  skipped: number;
  conflicts: ProjectConflict[];
};

/**
 * Apply a projection plan with **partial success**: non-conflicting links are
 * applied; conflicts are reported and never applied (XO-locked).
 *
 * Symlinks are **absolute** (v1).
 */
export async function applyProjection(
  plan: ProjectPlan,
  _opts: ApplyProjectionOptions = {},
): Promise<ApplyProjectionResult> {
  for (const dir of plan.ensureDirs) {
    await mkdir(dir, { recursive: true });
  }

  let linked = 0;
  let removed = 0;
  let skipped = 0;

  for (const removal of plan.removals ?? []) {
    try {
      const st = await lstat(removal.targetPath);
      if (!st.isSymbolicLink()) {
        skipped++;
        continue;
      }
      const linkTarget = await readlink(removal.targetPath);
      const absoluteTarget = isAbsolute(linkTarget)
        ? resolve(linkTarget)
        : resolve(dirname(removal.targetPath), linkTarget);
      if (absoluteTarget !== resolve(removal.originPath)) {
        skipped++;
        continue;
      }
      await rm(removal.targetPath, { force: true });
      removed++;
    } catch {
      skipped++;
    }
  }

  for (const link of plan.links) {
    if (link.action === "noop") {
      skipped++;
      continue;
    }

    // Parent of target (may be deeper than ensureDirs for safety)
    await mkdir(dirname(link.targetPath), { recursive: true });

    if (link.action === "relink") {
      await rm(link.targetPath, { force: true });
    }

    // Absolute symlink (v1)
    const originAbs = resolve(link.originPath);
    await symlink(originAbs, link.targetPath);
    linked++;
  }

  return {
    linked,
    removed,
    skipped,
    conflicts: [...plan.conflicts],
  };
}

// ---------------------------------------------------------------------------
// materializeEntry
// ---------------------------------------------------------------------------

/**
 * Write one corpus entry under origin.root with per-file lock.
 * Does not commit. Rejects path traversal outside origin.
 */
export async function materializeEntry(
  originRoot: string,
  input: MaterializeInput,
): Promise<MaterializeResult> {
  const absPath = resolveUnderOrigin(originRoot, input.originRelPath);

  // Parent dirs must exist before acquireLock (lock is `${absPath}.lock` via mkdir).
  await mkdir(dirname(absPath), { recursive: true });

  return withFileLock(absPath, async () => {
    let existing: string | null = null;
    try {
      const st = await lstat(absPath);
      if (st.isSymbolicLink()) {
        return {
          status: "conflict",
          absPath,
          reason: "destination is a symlink; refuse to materialize through unmanaged link",
        };
      }
      if (st.isDirectory()) {
        return {
          status: "conflict",
          absPath,
          reason: "destination is a directory",
        };
      }
      existing = await readFile(absPath, "utf-8");
    } catch {
      existing = null;
    }

    if (existing !== null) {
      if (existing === input.content) {
        return { status: "unchanged", absPath };
      }
      if (input.failIfChanged) {
        return {
          status: "conflict",
          absPath,
          reason: "destination exists with different content (failIfChanged)",
        };
      }
      await writeFile(absPath, input.content, "utf-8");
      return { status: "updated", absPath };
    }

    await writeFile(absPath, input.content, "utf-8");
    return { status: "created", absPath };
  });
}

// ---------------------------------------------------------------------------
// commitOriginPaths (optional git commit; no push)
// ---------------------------------------------------------------------------

export type CommitOriginResult = "committed" | "no-changes" | "not-a-repo" | `failed: ${string}`;

/**
 * Stage and commit specific origin-relative paths when origin is a git repo.
 * Does not push.
 */
export async function commitOriginPaths(
  originRoot: string,
  relPaths: string[],
  message: string,
): Promise<CommitOriginResult> {
  const root = resolve(originRoot);
  if (!(await isGitRepo(root))) return "not-a-repo";

  try {
    const absPaths: string[] = [];
    for (const rel of relPaths) {
      absPaths.push(resolveUnderOrigin(root, rel));
    }
    // git add prefers paths relative to repo root
    for (const abs of absPaths) {
      const rel = relative(root, abs);
      await git(["add", "--", rel], root);
    }
    const { stdout } = await git(["status", "--porcelain"], root);
    if (!stdout.trim()) return "no-changes";
    await git(["commit", "-m", message], root);
    return "committed";
  } catch (err) {
    return `failed: ${err instanceof Error ? err.message : String(err)}`;
  }
}

// ---------------------------------------------------------------------------
// Migrate + one-release backward-compat symlink
// ---------------------------------------------------------------------------

export type InstallLegacyCompatResult =
  | "created"
  | "already"
  | "conflict"
  | "skipped-missing-default";

/**
 * Install one-release backward-compat symlink:
 * `~/.local/share/memex-claude` → `~/.memex` (or custom paths).
 *
 * Fail-closed if legacy path is a real file/dir (non-link).
 */
export async function installLegacyOriginCompatSymlink(
  defaultRoot: string,
  opts: { legacyPath?: string; homeDir?: string } = {},
): Promise<InstallLegacyCompatResult> {
  const home = opts.homeDir ?? homedir();
  const legacy = resolve(opts.legacyPath ?? legacyClaudeOriginRoot(home));
  const dest = resolve(defaultRoot);

  if (!(await pathExists(dest))) {
    return "skipped-missing-default";
  }

  try {
    const st = await lstat(legacy);
    if (st.isSymbolicLink()) {
      const cur = await readlink(legacy);
      const absCur = isAbsolute(cur) ? resolve(cur) : resolve(dirname(legacy), cur);
      if (absCur === dest) return "already";
      try {
        if ((await realpath(legacy)) === (await realpath(dest))) return "already";
      } catch {
        // fall through to conflict if we cannot safely replace
      }
      return "conflict";
    }
    return "conflict";
  } catch {
    // missing — create
  }

  await mkdir(dirname(legacy), { recursive: true });
  await symlink(dest, legacy);
  return "created";
}

export type MigrateOriginResult =
  | { status: "migrated"; from: string; to: string; compat: InstallLegacyCompatResult }
  | { status: "already-at-default"; root: string }
  | { status: "source-missing"; from: string }
  | { status: "destination-exists"; to: string }
  | { status: "failed"; reason: string };

/**
 * Move an existing origin tree to the product default (`~/.memex`) and
 * optionally install the one-release legacy compat symlink.
 */
export async function migrateOriginToDefault(
  opts: { from?: string; homeDir?: string; installCompatSymlink?: boolean } = {},
): Promise<MigrateOriginResult> {
  const home = opts.homeDir ?? homedir();
  const to = defaultOriginRoot(home);
  const from = resolve(opts.from ?? legacyClaudeOriginRoot(home));

  if (from === to) {
    return { status: "already-at-default", root: to };
  }
  if (!(await pathExists(from))) {
    return { status: "source-missing", from };
  }
  if (await pathExists(to)) {
    return { status: "destination-exists", to };
  }

  try {
    await mkdir(dirname(to), { recursive: true });
    await rename(from, to);
  } catch (err) {
    return {
      status: "failed",
      reason: err instanceof Error ? err.message : String(err),
    };
  }

  let compat: InstallLegacyCompatResult = "skipped-missing-default";
  if (opts.installCompatSymlink !== false) {
    compat = await installLegacyOriginCompatSymlink(to, {
      legacyPath: from,
      homeDir: home,
    });
  }

  return { status: "migrated", from, to, compat };
}

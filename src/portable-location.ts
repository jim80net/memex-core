import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import type { ScanDirs } from "./skill-index.js";

/** A scan root with a stable, host-free label for portable handles. */
export type ScanRoot = {
  key: string;
  rootPath: string;
};

export type ScanRootRegistry = ScanRoot[];

export type ScanRootSpec = ScanDirs;

export type HarnessKind = "grok" | "claude" | "codex" | "hermes";

export type ScanRootContext = {
  cwd: string;
  syncRepoDir?: string;
  syncEnabled?: boolean;
  globalSkillsDirs: string[];
  globalRulesDirs: string[];
  projectSkillsDir: string;
  projectRulesDir: string;
  harness: HarnessKind;
};

export const HANDLE_PREFIX = "memex://";

export type PortableLocationWarn = (message: string) => void;

/**
 * Portable handles are opaque location tokens — not general URIs.
 * Form: memex://{rootKey}/{posix-rel}[#{fragment}]
 */
export function splitPortableHandle(handle: string): { body: string; fragment?: string } {
  const lastHash = handle.lastIndexOf("#");
  if (lastHash === -1) return { body: handle };
  return {
    body: handle.slice(0, lastHash),
    fragment: decodeFragment(handle.slice(lastHash + 1)),
  };
}

export function encodeFragment(fragment: string): string {
  return fragment.replace(/#/g, "%23");
}

export function decodeFragment(fragment: string): string {
  return fragment.replace(/%23/g, "#");
}

function normalizeRel(rel: string): string {
  return rel.split(sep).join("/");
}

function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p);
}

function hasUnsafeRelSegments(rel: string): boolean {
  const segments = rel.split("/");
  return segments.some((s) => s === ".." || s === "");
}

function isPathContained(rootPath: string, absolute: string): boolean {
  const root = resolve(rootPath);
  const normalized = resolve(absolute);
  return normalized === root || normalized.startsWith(root + sep);
}

function sortRegistry(roots: ScanRoot[]): ScanRootRegistry {
  return [...roots].sort((a, b) => b.rootPath.length - a.rootPath.length);
}

function matchRoot(registry: ScanRootRegistry, filePath: string): ScanRoot | undefined {
  const normalized = resolve(filePath);
  return registry.find((r) => isPathContained(r.rootPath, normalized));
}

function pathHasSegment(resolvedPath: string, segment: string): boolean {
  return resolve(resolvedPath).split(sep).includes(segment);
}

/** Stable fallback rootKey from normalized absolute dir path (§4.4 path-hash option). */
export function stableUnclassifiedKey(kind: "skill" | "rule" | "memory", dir: string): string {
  const hash = createHash("sha256").update(resolve(dir)).digest("hex").slice(0, 8);
  return `${kind}-unclassified-${hash}`;
}

/**
 * Build labeled scan roots from harness context and scan directory spec.
 * Same semantic root MUST use the same rootKey on every host (normative catalog).
 */
export function buildScanRoots(ctx: ScanRootContext, spec: ScanRootSpec): ScanRootRegistry {
  const harness = ctx.harness;
  const roots: ScanRoot[] = [];
  const seen = new Set<string>();

  const add = (key: string, dir: string) => {
    const rootPath = resolve(dir);
    if (seen.has(rootPath)) return;
    seen.add(rootPath);
    roots.push({ key, rootPath });
  };

  const globalSkillKeys = new Map<string, string>();
  for (const dir of ctx.globalSkillsDirs) {
    const resolved = resolve(dir);
    if (pathHasSegment(resolved, ".grok")) {
      globalSkillKeys.set(resolved, "grok-global");
    } else if (pathHasSegment(resolved, ".claude")) {
      globalSkillKeys.set(resolved, "claude-global");
    } else if (pathHasSegment(resolved, ".codex")) {
      globalSkillKeys.set(resolved, "codex-global");
    } else if (pathHasSegment(resolved, ".hermes")) {
      globalSkillKeys.set(resolved, "hermes-global");
    }
  }

  const globalRuleKeys = new Map<string, string>();
  for (const dir of ctx.globalRulesDirs) {
    const resolved = resolve(dir);
    if (pathHasSegment(resolved, ".grok")) {
      globalRuleKeys.set(resolved, "grok-rules-global");
    } else if (pathHasSegment(resolved, ".claude")) {
      globalRuleKeys.set(resolved, "claude-rules-global");
    } else if (pathHasSegment(resolved, ".codex")) {
      globalRuleKeys.set(resolved, "codex-rules-global");
    } else if (pathHasSegment(resolved, ".hermes")) {
      globalRuleKeys.set(resolved, "hermes-rules-global");
    }
  }

  const projectSkillsResolved = resolve(ctx.projectSkillsDir);
  const projectRulesResolved = resolve(ctx.projectRulesDir);
  const syncSkillsDir =
    ctx.syncEnabled && ctx.syncRepoDir ? resolve(join(ctx.syncRepoDir, "skills")) : undefined;
  const syncRulesDir =
    ctx.syncEnabled && ctx.syncRepoDir ? resolve(join(ctx.syncRepoDir, "rules")) : undefined;

  const unclassifiedSkillDirs: string[] = [];
  for (const dir of spec.skillDirs) {
    const resolved = resolve(dir);
    const catalogKey = globalSkillKeys.get(resolved);
    if (catalogKey) {
      add(catalogKey, dir);
    } else if (resolved === projectSkillsResolved) {
      add(`${harness}-project`, dir);
    } else if (syncSkillsDir && resolved === syncSkillsDir) {
      add("sync-skills", dir);
    } else {
      unclassifiedSkillDirs.push(dir);
    }
  }

  for (const dir of unclassifiedSkillDirs) {
    add(stableUnclassifiedKey("skill", dir), dir);
  }

  const unclassifiedRuleDirs: string[] = [];
  for (const dir of spec.ruleDirs) {
    const resolved = resolve(dir);
    const catalogKey = globalRuleKeys.get(resolved);
    if (catalogKey) {
      add(catalogKey, dir);
    } else if (resolved === projectRulesResolved) {
      add(`${harness}-rules-project`, dir);
    } else if (syncRulesDir && resolved === syncRulesDir) {
      add("sync-rules", dir);
    } else {
      unclassifiedRuleDirs.push(dir);
    }
  }

  for (const dir of unclassifiedRuleDirs) {
    add(stableUnclassifiedKey("rule", dir), dir);
  }

  for (const dir of spec.memoryDirs) {
    add(stableUnclassifiedKey("memory", dir), dir);
  }

  return sortRegistry(roots);
}

/**
 * Absolute path (+ optional #fragment) → portable handle.
 * Fail-open: returns null when mapping is impossible (caller should skip-with-warning).
 */
export function encodePortableLocation(
  registry: ScanRootRegistry,
  absolute: string,
  warn?: PortableLocationWarn,
): string | null {
  const { body, fragment } = splitPortableHandle(absolute);
  const root = matchRoot(registry, body);
  if (!root) {
    warn?.(`skipped indexing ${absolute} — no portable handle (outside registered scan roots)`);
    return null;
  }

  const rel = normalizeRel(relative(root.rootPath, resolve(body)));
  if (hasUnsafeRelSegments(rel)) {
    warn?.(`skipped indexing ${absolute} — no portable handle (unsafe relative path: ${rel})`);
    return null;
  }

  const handle = `${HANDLE_PREFIX}${root.key}/${rel}`;
  if (!fragment) return handle;
  return `${handle}#${encodeFragment(fragment)}`;
}

/**
 * Portable handle → absolute path (+ optional #fragment). Fail-closed on traversal escape.
 */
export function decodePortableLocation(registry: ScanRootRegistry, handle: string): string {
  if (!handle.startsWith(HANDLE_PREFIX)) {
    throw new Error(`invalid portable location handle: ${handle}`);
  }

  const { body, fragment } = splitPortableHandle(handle.slice(HANDLE_PREFIX.length));
  const slash = body.indexOf("/");
  if (slash === -1) {
    throw new Error(`invalid portable location handle (missing path segment): ${handle}`);
  }

  const key = body.slice(0, slash);
  const rel = body.slice(slash + 1);
  if (hasUnsafeRelSegments(rel)) {
    throw new Error(`portable location handle escapes scan root: ${handle}`);
  }

  const root = registry.find((r) => r.key === key);
  if (!root) {
    throw new Error(`unknown portable location root '${key}'`);
  }

  const absolute = resolve(root.rootPath, rel);
  if (!isPathContained(root.rootPath, absolute)) {
    throw new Error(`portable location handle escapes scan root: ${handle}`);
  }

  return fragment ? `${absolute}#${fragment}` : absolute;
}

/**
 * Resolve portable handle or legacy absolute path to absolute for filesystem I/O.
 * Phase 2: agent-facing read tools MUST pass `allowAbsolute: false` so untrusted
 * absolute paths cannot bypass containment (memex-grok#19 closes only then).
 */
export function resolvePortableLocation(
  registry: ScanRootRegistry,
  input: string,
  options?: { warn?: PortableLocationWarn; allowAbsolute?: boolean },
): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;

  if (trimmed.startsWith(HANDLE_PREFIX)) {
    return decodePortableLocation(registry, trimmed);
  }

  if (options?.allowAbsolute !== false && isAbsolutePath(trimmed)) {
    options?.warn?.(
      `deprecated: readSkillContent received absolute path; use portable memex:// handles`,
    );
    return trimmed;
  }

  throw new Error(`unrecognized location: ${input}`);
}

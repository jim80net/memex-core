import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { parseEntryLifecycle } from "./lifecycle.js";
import {
  decodePortableLocationResolved,
  encodePortableLocation,
  type ScanRootRegistry,
} from "./portable-location.js";

export type ConsistencyManifest = {
  version: 1;
  expectedCoreVersion: string;
  adapters: Array<{ name: string; root: string }>;
  portableLocations: Array<{
    name: string;
    roots: ScanRootRegistry;
    absolute: string;
    handle: string;
  }>;
  projections: Array<{ name: string; source: string; target: string }>;
  sharedFormats: Array<{ name: string; files: string[] }>;
};

export type ConsistencyCheck = {
  id: string;
  ok: boolean;
  evidence?: Record<string, unknown>;
  error?: string;
};

export type ConsistencyReport = {
  schemaVersion: 1;
  ok: boolean;
  checks: ConsistencyCheck[];
};

const corePackage = "@jim80net/memex-core";

export function parseAuditContractArgs(args: string[], cwd = process.cwd()): string {
  if (!args.includes("--json")) {
    throw new Error("expected: audit-contracts --json [--manifest <path>]");
  }
  const remaining = args.filter((arg) => arg !== "--json");
  if (
    !(
      remaining.length === 0 ||
      (remaining.length === 2 && remaining[0] === "--manifest" && remaining[1])
    )
  ) {
    throw new Error("expected: audit-contracts --json [--manifest <path>]");
  }
  return resolve(cwd, remaining[1] ?? "audit-contracts.json");
}

function absoluteFrom(base: string, path: string): string {
  return isAbsolute(path) ? path : resolve(base, path);
}

function lockVersion(lock: string, declared: string): string | undefined {
  const escaped = corePackage.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const block = lock.match(new RegExp(`['"]?${escaped}['"]?:\\n((?: {4,}.*\\n?)+)`))?.[1];
  if (!block) return undefined;
  const specifier = block.match(/specifier:\s*([^\s]+)/)?.[1];
  if (specifier !== declared) return undefined;
  return block.match(/version:\s*([0-9]+\.[0-9]+\.[0-9]+)/)?.[1];
}

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function adapterCheck(
  adapter: ConsistencyManifest["adapters"][number],
  expected: string,
  base: string,
): Promise<ConsistencyCheck> {
  const id = `adapter:${adapter.name}`;
  try {
    const root = absoluteFrom(base, adapter.root);
    const packageJson = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
    const declared =
      packageJson.dependencies?.[corePackage] ?? packageJson.devDependencies?.[corePackage];
    if (typeof declared !== "string") throw new Error(`missing ${corePackage} declaration`);
    const lock = await readFile(join(root, "pnpm-lock.yaml"), "utf8");
    const resolved = lockVersion(lock, declared);
    if (!resolved) throw new Error("lockfile declaration/resolution is missing or inconsistent");
    const installedJson = JSON.parse(
      await readFile(join(root, "node_modules", corePackage, "package.json"), "utf8"),
    );
    const installed = installedJson.version;
    const ok = resolved === expected && installed === expected;
    return {
      id,
      ok,
      evidence: { declared, resolved, installed, expected },
      ...(!ok ? { error: "resolved or installed Core version differs from expected" } : {}),
    };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function portableCheck(
  vector: ConsistencyManifest["portableLocations"][number],
  base: string,
): Promise<ConsistencyCheck> {
  const id = `portable:${vector.name}`;
  try {
    const roots = vector.roots.map((root) => ({
      ...root,
      rootPath: absoluteFrom(base, root.rootPath),
    }));
    const absolute = absoluteFrom(base, vector.absolute);
    const encoded = encodePortableLocation(roots, absolute);
    const decoded = decodePortableLocationResolved(roots, vector.handle).filePath;
    const ok = encoded === vector.handle && resolve(decoded) === resolve(absolute);
    return {
      id,
      ok,
      evidence: { encoded, expected: vector.handle, decoded },
      ...(!ok ? { error: "portable location vector did not round-trip" } : {}),
    };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function projectionCheck(
  projection: ConsistencyManifest["projections"][number],
  base: string,
): Promise<ConsistencyCheck> {
  const id = `projection:${projection.name}`;
  try {
    const source = absoluteFrom(base, projection.source);
    const target = absoluteFrom(base, projection.target);
    const sourceStat = await lstat(source);
    const lifecyclePath = sourceStat.isDirectory() ? join(source, "SKILL.md") : source;
    const lifecycle = parseEntryLifecycle(await readFile(lifecyclePath, "utf8"));
    let targetKind = "missing";
    let provenance: string | undefined;
    try {
      const stat = await lstat(target);
      targetKind = stat.isSymbolicLink() ? "symlink" : stat.isDirectory() ? "directory" : "file";
      if (stat.isSymbolicLink()) provenance = await realpath(target);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const ok =
      lifecycle === "retired"
        ? targetKind === "missing"
        : targetKind === "symlink" && provenance === (await realpath(source));
    return {
      id,
      ok,
      evidence: { lifecycle, targetKind, provenance, source },
      ...(!ok ? { error: "projection lifecycle or provenance is inconsistent" } : {}),
    };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function sharedFormatCheck(
  group: ConsistencyManifest["sharedFormats"][number],
  base: string,
): Promise<ConsistencyCheck> {
  const id = `shared-format:${group.name}`;
  try {
    if (group.files.length < 2) throw new Error("shared-format group requires at least two files");
    const hashes = await Promise.all(
      group.files.map(async (file) => sha256(await readFile(absoluteFrom(base, file)))),
    );
    const ok = new Set(hashes).size === 1;
    return {
      id,
      ok,
      evidence: { files: group.files, hashes },
      ...(!ok ? { error: "shared-format fixture bytes differ" } : {}),
    };
  } catch (error) {
    return { id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function runConsistencyAudit(
  manifest: ConsistencyManifest,
  manifestPath: string,
): Promise<ConsistencyReport> {
  if (manifest.version !== 1) {
    return {
      schemaVersion: 1,
      ok: false,
      checks: [{ id: "manifest", ok: false, error: "unsupported manifest version" }],
    };
  }
  const base = dirname(resolve(manifestPath));
  const checks = await Promise.all([
    ...manifest.adapters.map((item) => adapterCheck(item, manifest.expectedCoreVersion, base)),
    ...manifest.portableLocations.map((item) => portableCheck(item, base)),
    ...manifest.projections.map((item) => projectionCheck(item, base)),
    ...manifest.sharedFormats.map((item) => sharedFormatCheck(item, base)),
  ]);
  return { schemaVersion: 1, ok: checks.every((check) => check.ok), checks };
}

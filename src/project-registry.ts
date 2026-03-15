import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { ProjectRegistry } from "./types.js";

export async function loadRegistry(registryPath: string): Promise<ProjectRegistry> {
  const empty: ProjectRegistry = { version: 1, projects: {} };
  try {
    const raw = await readFile(registryPath, "utf-8");
    const data = JSON.parse(raw) as ProjectRegistry;
    if (data.version !== 1) return empty;
    return data;
  } catch {
    return empty;
  }
}

export async function saveRegistry(registryPath: string, data: ProjectRegistry): Promise<void> {
  const dir = dirname(registryPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${registryPath}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmpPath, registryPath);
}

/**
 * Register a project cwd as known. Mutates in place.
 */
export function registerProject(registry: ProjectRegistry, cwd: string): void {
  registry.projects[cwd] = { lastSeen: new Date().toISOString() };
}

/**
 * Get list of known project paths, sorted by most recently seen.
 */
export function getKnownProjects(registry: ProjectRegistry): string[] {
  return Object.entries(registry.projects)
    .sort(([, a], [, b]) => b.lastSeen.localeCompare(a.lastSeen))
    .map(([path]) => path);
}

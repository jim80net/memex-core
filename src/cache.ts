import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { CacheData, CachedSkill, IndexedSkill } from "./types.js";

const CACHE_VERSION = 2 as const;

export async function loadCache(cachePath: string, embeddingModel: string): Promise<CacheData> {
  const empty: CacheData = { version: CACHE_VERSION, embeddingModel, skills: {} };
  try {
    const raw = await readFile(cachePath, "utf-8");
    const data = JSON.parse(raw) as CacheData;
    if (data.version !== CACHE_VERSION || data.embeddingModel !== embeddingModel) {
      return empty;
    }
    return data;
  } catch {
    return empty;
  }
}

export async function saveCache(cachePath: string, data: CacheData): Promise<void> {
  const dir = dirname(cachePath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${cachePath}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data), "utf-8");
  await rename(tmpPath, cachePath);
}

export function getCachedSkill(cache: CacheData, location: string): CachedSkill | undefined {
  return cache.skills[location];
}

export function setCachedSkill(cache: CacheData, location: string, skill: CachedSkill): void {
  cache.skills[location] = skill;
}

export function removeCachedSkill(cache: CacheData, location: string): void {
  delete cache.skills[location];
}

export function toCachedSkill(skill: IndexedSkill, mtime: number): CachedSkill {
  return {
    name: skill.name,
    description: skill.description,
    queries: skill.queries,
    embeddings: skill.embeddings,
    mtime,
    type: skill.type,
    oneLiner: skill.oneLiner,
  };
}

export function fromCachedSkill(location: string, cached: CachedSkill): IndexedSkill {
  return {
    name: cached.name,
    description: cached.description,
    location,
    type: cached.type,
    embeddings: cached.embeddings,
    queries: cached.queries,
    oneLiner: cached.oneLiner,
  };
}

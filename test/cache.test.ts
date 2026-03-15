import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadCache, saveCache, toCachedSkill, fromCachedSkill } from "../src/cache.ts";
import type { CacheData, IndexedSkill } from "../src/types.ts";

describe("cache", () => {
  let tmpDir: string;
  let cachePath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `cache-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    cachePath = join(tmpDir, "skill-router.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("round-trips through JSON", async () => {
    const cache: CacheData = {
      version: 2,
      embeddingModel: "text-embedding-3-small",
      skills: {
        "/path/to/skill/SKILL.md": {
          name: "test-skill",
          description: "A test skill",
          queries: ["how to test", "run tests"],
          embeddings: [[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]],
          mtime: 1234567890,
          type: "skill",
        },
      },
    };

    await saveCache(cachePath, cache);
    const loaded = await loadCache(cachePath, "text-embedding-3-small");

    expect(loaded.version).toBe(2);
    expect(loaded.embeddingModel).toBe("text-embedding-3-small");
    expect(loaded.skills["/path/to/skill/SKILL.md"].name).toBe("test-skill");
    expect(loaded.skills["/path/to/skill/SKILL.md"].embeddings).toHaveLength(2);
  });

  it("invalidates cache when model changes", async () => {
    const cache: CacheData = {
      version: 2,
      embeddingModel: "text-embedding-3-small",
      skills: {
        "/a": { name: "a", description: "a", queries: [], embeddings: [], mtime: 0, type: "skill" },
      },
    };
    await saveCache(cachePath, cache);

    const loaded = await loadCache(cachePath, "text-embedding-3-large");
    expect(Object.keys(loaded.skills)).toHaveLength(0);
  });

  it("validates cache when model matches", async () => {
    const cache: CacheData = {
      version: 2,
      embeddingModel: "text-embedding-3-small",
      skills: {
        "/a": { name: "a", description: "a", queries: [], embeddings: [], mtime: 0, type: "skill" },
      },
    };
    await saveCache(cachePath, cache);

    const loaded = await loadCache(cachePath, "text-embedding-3-small");
    expect(Object.keys(loaded.skills)).toHaveLength(1);
  });

  it("returns empty cache when file does not exist", async () => {
    const loaded = await loadCache(join(tmpDir, "nonexistent.json"), "model");
    expect(loaded.version).toBe(2);
    expect(Object.keys(loaded.skills)).toHaveLength(0);
  });

  it("toCachedSkill converts IndexedSkill + mtime", () => {
    const skill: IndexedSkill = {
      name: "test",
      description: "desc",
      location: "/test/SKILL.md",
      type: "skill",
      embeddings: [[1, 2, 3]],
      queries: ["q1"],
      oneLiner: "one liner",
    };
    const cached = toCachedSkill(skill, 999);
    expect(cached.name).toBe("test");
    expect(cached.mtime).toBe(999);
    expect(cached.oneLiner).toBe("one liner");
  });

  it("fromCachedSkill converts CachedSkill to IndexedSkill", () => {
    const cached = {
      name: "test",
      description: "desc",
      queries: ["q1"],
      embeddings: [[1, 2, 3]],
      mtime: 999,
      type: "skill" as const,
      oneLiner: "one liner",
    };
    const skill = fromCachedSkill("/loc", cached);
    expect(skill.name).toBe("test");
    expect(skill.location).toBe("/loc");
    expect(skill.oneLiner).toBe("one liner");
    // IndexedSkill should NOT have mtime
    expect((skill as any).mtime).toBeUndefined();
  });
});

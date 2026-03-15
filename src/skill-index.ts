import { readdir, readFile, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { fromCachedSkill, loadCache, saveCache, toCachedSkill } from "./cache.js";
import type { EmbeddingProvider } from "./embeddings.js";
import { cosineSimilarity } from "./embeddings.js";
import type {
  CacheData,
  IndexedSkill,
  MemexCoreConfig,
  ParsedFrontmatter,
  ScoringMode,
  SkillSearchResult,
  SkillType,
} from "./types.js";

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

const LIST_KEYS = new Set(["queries", "paths", "hooks", "keywords"]);

export function parseFrontmatter(content: string): { meta: ParsedFrontmatter; body: string } {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!match) return { meta: {}, body: content };

  const frontmatter = match[1];
  const body = match[2];
  const meta: ParsedFrontmatter = {};

  let currentListKey = "";
  const listAccumulators: Record<string, string[]> = {};

  for (const line of frontmatter.split(/\r?\n/)) {
    // Continue accumulating list items
    if (currentListKey) {
      const listItem = line.match(/^\s+-\s+(.*)/);
      if (listItem) {
        listAccumulators[currentListKey].push(listItem[1].replace(/^["']|["']$/g, "").trim());
        continue;
      }
      currentListKey = "";
    }

    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawValue = line.slice(colonIdx + 1).trim();
    const value = rawValue.replace(/^["']|["']$/g, "");

    // Scalar keys
    if (key === "name") meta.name = value;
    if (key === "description") meta.description = value;
    if (key === "type") meta.type = value as SkillType;
    if (key === "one-liner") meta.oneLiner = value;

    // List keys — block-style (empty value + indented items) or inline value
    if (LIST_KEYS.has(key)) {
      if (rawValue === "") {
        currentListKey = key;
        listAccumulators[key] = [];
      } else {
        // Inline value: treat as a single-element list
        listAccumulators[key] = listAccumulators[key] || [];
        listAccumulators[key].push(value);
      }
    }
  }

  if (listAccumulators.queries?.length) meta.queries = listAccumulators.queries;
  if (listAccumulators.paths?.length) meta.paths = listAccumulators.paths;
  if (listAccumulators.hooks?.length) meta.hooks = listAccumulators.hooks;
  if (listAccumulators.keywords?.length) meta.keywords = listAccumulators.keywords;

  return { meta, body };
}

// ---------------------------------------------------------------------------
// Memory file parsing
// ---------------------------------------------------------------------------

/**
 * Parse a memory markdown file into sections.
 * Extracts ## sections and looks for `Triggers:` lines as queries.
 */
export function parseMemoryFile(
  content: string,
  _filePath: string,
): Array<{ name: string; description: string; queries: string[]; body: string }> {
  const results: Array<{ name: string; description: string; queries: string[]; body: string }> = [];

  const sections = content.split(/^(?=##\s)/m);

  for (const section of sections) {
    const headingMatch = section.match(/^##\s+(.+)/);
    if (!headingMatch) continue;

    const name = headingMatch[1].trim();
    const bodyLines: string[] = [];
    const queries: string[] = [];

    for (const line of section.split(/\r?\n/).slice(1)) {
      const triggerMatch = line.match(/^Triggers?:\s*(.+)/i);
      if (triggerMatch) {
        const raw = triggerMatch[1];
        const parsed = raw
          .split(/,\s*/)
          .map((t) => t.replace(/^["']|["']$/g, "").trim())
          .filter((t) => t.length > 0);
        queries.push(...parsed);
      } else {
        bodyLines.push(line);
      }
    }

    const body = bodyLines.join("\n").trim();
    if (body.length > 0 || queries.length > 0) {
      const description = body.split("\n")[0]?.trim() || name;
      results.push({ name, description, queries, body });
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Directory scanning
// ---------------------------------------------------------------------------

async function scanSkillDirs(dirs: string[]): Promise<string[]> {
  const skillFiles: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      const skillMd = join(dir, entry, "SKILL.md");
      try {
        await stat(skillMd);
        skillFiles.push(skillMd);
      } catch {
        // No SKILL.md in this subdirectory
      }
    }
  }

  return skillFiles;
}

async function scanMemoryDirs(dirs: string[]): Promise<string[]> {
  const memoryFiles: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      if (entry === "MEMORY.md") continue;
      memoryFiles.push(join(dir, entry));
    }
  }

  return memoryFiles;
}

async function scanRuleDirs(dirs: string[]): Promise<string[]> {
  const ruleFiles: string[] = [];

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.endsWith(".md")) continue;
      ruleFiles.push(join(dir, entry));
    }
  }

  return ruleFiles;
}

// ---------------------------------------------------------------------------
// Scan directories descriptor
// ---------------------------------------------------------------------------

export type ScanDirs = {
  skillDirs: string[];
  memoryDirs: string[];
  ruleDirs: string[];
};

// ---------------------------------------------------------------------------
// SkillIndex
// ---------------------------------------------------------------------------

type ToEmbed = {
  name: string;
  description: string;
  location: string;
  queries: string[];
  type: SkillType;
  mtime: number;
  body: string;
  oneLiner?: string;
};

export class SkillIndex {
  private skills: IndexedSkill[] = [];
  private skillMtimes: Map<string, number> = new Map();
  private cache: CacheData | null = null;
  private cacheLoaded = false;
  private buildTime = 0;

  constructor(
    private config: MemexCoreConfig,
    private provider: EmbeddingProvider,
    private cachePath: string,
  ) {}

  get skillCount(): number {
    return this.skills.length;
  }

  needsRebuild(): boolean {
    if (this.buildTime === 0) return true;
    return Date.now() - this.buildTime >= this.config.cacheTimeMs;
  }

  /**
   * Build the index by scanning all skill, rule, and memory directories.
   * Uses cache for unchanged files (mtime-gated).
   */
  async build(scanDirs: ScanDirs): Promise<void> {
    // Load persistent cache on first build
    if (!this.cacheLoaded) {
      this.cache = await loadCache(this.cachePath, this.config.embeddingModel);
      this.cacheLoaded = true;

      // Hydrate from cache on cold start
      if (this.skills.length === 0 && Object.keys(this.cache.skills).length > 0) {
        for (const [location, cached] of Object.entries(this.cache.skills)) {
          this.skills.push(fromCachedSkill(location, cached));
          this.skillMtimes.set(location, cached.mtime);
        }
      }
    }

    // Scan all sources in parallel
    const [skillFiles, memoryFiles, ruleFiles] = await Promise.all([
      scanSkillDirs(scanDirs.skillDirs),
      scanMemoryDirs(scanDirs.memoryDirs),
      scanRuleDirs(scanDirs.ruleDirs),
    ]);

    // Stat all files to detect changes
    type FileKind = "skill" | "memory" | "rule";
    type FileInfo = { location: string; mtime: number; kind: FileKind };

    const statPromises = [
      ...skillFiles.map(async (f): Promise<FileInfo | null> => {
        try {
          const s = await stat(f);
          return { location: f, mtime: s.mtimeMs, kind: "skill" };
        } catch {
          return null;
        }
      }),
      ...memoryFiles.map(async (f): Promise<FileInfo | null> => {
        try {
          const s = await stat(f);
          return { location: f, mtime: s.mtimeMs, kind: "memory" };
        } catch {
          return null;
        }
      }),
      ...ruleFiles.map(async (f): Promise<FileInfo | null> => {
        try {
          const s = await stat(f);
          return { location: f, mtime: s.mtimeMs, kind: "rule" };
        } catch {
          return null;
        }
      }),
    ];

    const statResults = (await Promise.all(statPromises)).filter(
      (r): r is FileInfo => r !== null,
    );

    const currentLocations = new Set(statResults.map((s) => s.location));

    // Check for changes (fast path: skip if nothing changed)
    const anyNew = statResults.some((s) => !this.skillMtimes.has(s.location));
    const anyChanged = statResults.some((s) => this.skillMtimes.get(s.location) !== s.mtime);
    const anyDeleted = [...this.skillMtimes.keys()].some((loc) => !currentLocations.has(loc));

    if (this.buildTime > 0 && !anyNew && !anyChanged && !anyDeleted) {
      this.buildTime = Date.now();
      return;
    }

    // Find files that need (re)embedding
    const toEmbed: ToEmbed[] = [];

    for (const info of statResults) {
      if (info.kind === "memory") {
        // Memory files may produce multiple sections — each keyed as "path#SectionName"
        const cachedMtime = this.skillMtimes.get(info.location);
        if (cachedMtime === info.mtime) continue;

        // Remove old sections for this memory file
        this.skills = this.skills.filter((s) => !s.location.startsWith(`${info.location}#`));
        if (this.cache) {
          for (const key of Object.keys(this.cache.skills)) {
            if (key.startsWith(`${info.location}#`)) delete this.cache.skills[key];
          }
        }

        try {
          const raw = await readFile(info.location, "utf-8");
          this.parseMemoryFileForEmbed(raw, info, toEmbed);
        } catch {
          // Skip unreadable
        }
        this.skillMtimes.set(info.location, info.mtime);
        continue;
      }

      // Skills and rules
      const cached = this.cache?.skills[info.location];
      if (cached && cached.mtime === info.mtime) {
        // Use cached embeddings — no re-embed
        const existing = this.skills.findIndex((s) => s.location === info.location);
        const skill = fromCachedSkill(info.location, cached);
        if (existing >= 0) this.skills[existing] = skill;
        else if (!this.skills.some((s) => s.location === info.location)) this.skills.push(skill);
        this.skillMtimes.set(info.location, info.mtime);
        continue;
      }

      // Check in-memory cache
      const unchanged =
        this.skillMtimes.get(info.location) === info.mtime &&
        this.skills.some((s) => s.location === info.location);
      if (unchanged) continue;

      try {
        const raw = await readFile(info.location, "utf-8");
        if (info.kind === "rule") {
          this.parseRuleFileForEmbed(raw, info, toEmbed);
        } else {
          this.parseSkillFileForEmbed(raw, info, toEmbed);
        }
      } catch {
        // Skip unreadable files
      }
    }

    // Embed new/changed entries in one batch
    if (toEmbed.length > 0) {
      const flatQueries = toEmbed.flatMap((p) => p.queries);
      const flatEmbeddings = await this.provider.embed(flatQueries);

      let offset = 0;
      for (const item of toEmbed) {
        const embeddings = flatEmbeddings.slice(offset, offset + item.queries.length);
        const skill: IndexedSkill = {
          name: item.name,
          description: item.description,
          location: item.location,
          type: item.type,
          embeddings,
          queries: item.queries,
          oneLiner: item.oneLiner,
        };

        const existing = this.skills.findIndex((s) => s.location === item.location);
        if (existing >= 0) this.skills[existing] = skill;
        else this.skills.push(skill);

        // Update persistent cache
        if (this.cache) {
          this.cache.skills[item.location] = toCachedSkill(skill, item.mtime);
        }

        offset += item.queries.length;
      }
    }

    // Remove deleted entries (handle memory section keys like "path#SectionName")
    this.skills = this.skills.filter((s) => {
      const baseLocation = s.location.includes("#") ? s.location.split("#")[0] : s.location;
      return currentLocations.has(baseLocation) || currentLocations.has(s.location);
    });

    // Clean cache of deleted entries
    if (this.cache) {
      for (const key of Object.keys(this.cache.skills)) {
        const baseKey = key.includes("#") ? key.split("#")[0] : key;
        if (!currentLocations.has(baseKey) && !currentLocations.has(key)) {
          delete this.cache.skills[key];
        }
      }
    }

    // Update mtime tracking
    this.skillMtimes = new Map(statResults.map((s) => [s.location, s.mtime]));

    // Persist cache (fire-and-forget)
    if (this.cache && toEmbed.length > 0) {
      saveCache(this.cachePath, this.cache).catch(() => {
        // Cache save is best-effort
      });
    }

    this.buildTime = Date.now();
  }

  /**
   * Search the index for skills matching the query.
   * Supports both relative and absolute scoring modes.
   */
  async search(
    query: string,
    topK: number,
    threshold: number,
    typeFilter?: SkillType[],
    scoringMode: ScoringMode = "absolute",
    maxDropoff: number = 0.15,
  ): Promise<SkillSearchResult[]> {
    let candidates = this.skills;
    if (typeFilter && typeFilter.length > 0) {
      const allowed = new Set(typeFilter);
      candidates = candidates.filter((s) => allowed.has(s.type));
    }

    if (candidates.length === 0) return [];

    const [queryEmbedding] = await this.provider.embed([query]);

    const scored = candidates.map((skill) => {
      const similarities = skill.embeddings.map((e) => cosineSimilarity(queryEmbedding, e));
      const score = Math.max(...similarities);
      return { skill, score };
    });

    const sorted = scored.sort((a, b) => b.score - a.score);

    if (scoringMode === "relative") {
      // Relative mode: if the best match clears the floor, inject top-K
      // but drop results that fall too far below the best
      if (sorted.length === 0 || sorted[0].score < threshold) return [];
      const bestScore = sorted[0].score;
      return sorted.filter((r) => bestScore - r.score <= maxDropoff).slice(0, topK);
    }

    // Absolute mode: each result must individually pass threshold
    return sorted.filter((r) => r.score >= threshold).slice(0, topK);
  }

  /**
   * Read the body content of a skill file, stripping frontmatter.
   */
  async readSkillContent(location: string): Promise<string> {
    if (location.includes("#")) {
      const [filePath, sectionName] = location.split("#", 2);
      const raw = await readFile(filePath, "utf-8");
      const sections = parseMemoryFile(raw, filePath);
      const section = sections.find((s) => s.name === sectionName);
      return section?.body.trim() || "";
    }

    const raw = await readFile(location, "utf-8");
    const { body } = parseFrontmatter(raw);
    return body.trim();
  }

  // -------------------------------------------------------------------------
  // Private parsing helpers
  // -------------------------------------------------------------------------

  private parseSkillFileForEmbed(
    raw: string,
    info: { location: string; mtime: number },
    toEmbed: ToEmbed[],
  ): void {
    const { meta, body } = parseFrontmatter(raw);
    if (!meta.name || !meta.description) return;
    const queries = meta.queries?.length ? meta.queries : [meta.description];
    const type = meta.type || "skill";
    toEmbed.push({
      name: meta.name,
      description: meta.description,
      location: info.location,
      queries,
      type,
      mtime: info.mtime,
      body,
      oneLiner: meta.oneLiner,
    });
  }

  private parseMemoryFileForEmbed(
    raw: string,
    info: { location: string; mtime: number },
    toEmbed: ToEmbed[],
  ): void {
    const sections = parseMemoryFile(raw, info.location);
    for (const section of sections) {
      const key = `${info.location}#${section.name}`;
      const queries = section.queries.length > 0 ? section.queries : [section.description];
      toEmbed.push({
        name: section.name,
        description: section.description,
        location: key,
        queries,
        type: "memory",
        mtime: info.mtime,
        body: section.body,
      });
    }
  }

  private parseRuleFileForEmbed(
    raw: string,
    info: { location: string; mtime: number },
    toEmbed: ToEmbed[],
  ): void {
    const { meta, body } = parseFrontmatter(raw);

    const name = meta.name || basename(info.location, ".md");
    const description = meta.description || body.split("\n")[0]?.trim() || name;
    const oneLiner = meta.oneLiner || description;

    const queries: string[] = [];
    if (meta.queries?.length) queries.push(...meta.queries);
    if (meta.keywords?.length) queries.push(...meta.keywords);
    if (queries.length === 0) queries.push(description);

    toEmbed.push({
      name,
      description,
      location: info.location,
      queries,
      type: "rule",
      mtime: info.mtime,
      body,
      oneLiner,
    });
  }
}

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveCache } from "../src/cache.ts";
import { DEFAULT_CORE_CONFIG } from "../src/config.ts";
import type { EmbeddingProvider } from "../src/embeddings.ts";
import { cosineSimilarity } from "../src/embeddings.ts";
import {
  buildScanRoots,
  encodeFragment,
  encodePortableLocation,
} from "../src/portable-location.ts";
import type { ScanDirs } from "../src/skill-index.ts";
import { parseFrontmatter, parseMemoryFile, SkillIndex } from "../src/skill-index.ts";

// ---------------------------------------------------------------------------
// Frontmatter parsing
// ---------------------------------------------------------------------------

describe("parseFrontmatter", () => {
  it("parses lifecycle status", () => {
    const { meta } = parseFrontmatter(
      "---\nname: old-rule\ndescription: retired rule\nstatus: retired\n---\nbody",
    );
    expect(meta.status).toBe("retired");
  });

  it("parses name, description, and type from frontmatter", () => {
    const content = `---
name: weather
description: "Get current weather and forecasts"
type: skill
---
# Weather Skill

Do stuff with weather.`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBe("weather");
    expect(meta.description).toBe("Get current weather and forecasts");
    expect(meta.type).toBe("skill");
    expect(body).toContain("# Weather Skill");
  });

  it("handles single-quoted values", () => {
    const content = `---\nname: 'my-skill'\ndescription: 'A skill'\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.name).toBe("my-skill");
    expect(meta.description).toBe("A skill");
  });

  it("handles unquoted values", () => {
    const content = `---\nname: simple\ndescription: plain description\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.name).toBe("simple");
    expect(meta.description).toBe("plain description");
  });

  it.each([
    ">-",
    ">",
    "|-",
    "|",
  ])("normalizes %s description block scalars into search-safe text", (indicator) => {
    const content = `---\nname: multiline\ndescription: ${indicator}\n  First line of the teaser\n  continues on the second line.\n---\nbody`;
    const { meta } = parseFrontmatter(content);

    expect(meta.description).toBe("First line of the teaser continues on the second line.");
    expect(meta.description).not.toContain("\n");
    expect(meta.description).not.toBe(indicator);
  });

  it.each([
    "sync-main",
    "storm",
  ])("parses the %s folded-description regression fixture", async (fixtureName) => {
    const content = await readFile(
      new URL(`./fixtures/folded-frontmatter/${fixtureName}.md`, import.meta.url),
      "utf8",
    );
    const { meta } = parseFrontmatter(content);

    expect(meta.name).toBe(fixtureName);
    expect(meta.description?.length).toBeGreaterThan(40);
    expect(meta.description).not.toContain("\n");
    expect(meta.description).not.toBe(">-");
  });

  it("returns empty meta when no frontmatter present", () => {
    const content = "# Just a heading\n\nSome content.";
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBeUndefined();
    expect(meta.description).toBeUndefined();
    expect(body).toBe(content);
  });

  it("parses queries list from frontmatter", () => {
    const content = `---
name: weather
description: Get weather
queries:
  - "What is the weather today?"
  - "Show me the forecast"
  - "Is it going to rain?"
---
# Weather`;
    const { meta } = parseFrontmatter(content);
    expect(meta.queries).toHaveLength(3);
    expect(meta.queries?.[0]).toBe("What is the weather today?");
    expect(meta.queries?.[1]).toBe("Show me the forecast");
    expect(meta.queries?.[2]).toBe("Is it going to rain?");
  });

  it("parses type: memory", () => {
    const content = `---\nname: prefer-bun\ndescription: Use bun over npm\ntype: memory\n---\nUse bun.`;
    const { meta } = parseFrontmatter(content);
    expect(meta.type).toBe("memory");
  });

  it("defaults type to undefined when not specified", () => {
    const content = `---\nname: test\ndescription: desc\n---\nbody`;
    const { meta } = parseFrontmatter(content);
    expect(meta.type).toBeUndefined();
  });

  it("parses rule frontmatter with paths, hooks, keywords, one-liner", () => {
    const content = `---
name: prefer-pnpm
description: "Use pnpm instead of npm"
type: rule
one-liner: "Use pnpm, not npm."
paths:
  - "package.json"
  - "*.ts"
hooks:
  - UserPromptSubmit
  - PreToolUse
keywords:
  - pnpm
  - "package manager"
queries:
  - "install dependencies"
  - "npm install"
---
Always use pnpm for all package management.`;
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBe("prefer-pnpm");
    expect(meta.type).toBe("rule");
    expect(meta.oneLiner).toBe("Use pnpm, not npm.");
    expect(meta.paths).toEqual(["package.json", "*.ts"]);
    expect(meta.hooks).toEqual(["UserPromptSubmit", "PreToolUse"]);
    expect(meta.keywords).toEqual(["pnpm", "package manager"]);
    expect(meta.queries).toEqual(["install dependencies", "npm install"]);
    expect(body).toContain("Always use pnpm");
  });

  it("handles rule files without frontmatter", () => {
    const content = "Always use pnpm instead of npm.";
    const { meta, body } = parseFrontmatter(content);
    expect(meta.name).toBeUndefined();
    expect(body).toBe(content);
  });

  it("parses inline list values (single item on same line as key)", () => {
    const content = `---
name: test-skill
description: A test skill
queries: "how do I test?"
keywords: testing
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.queries).toEqual(["how do I test?"]);
    expect(meta.keywords).toEqual(["testing"]);
  });

  it("parses boost as a float from frontmatter", () => {
    const content = `---
name: boosted-skill
description: A skill with boost
boost: 0.05
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.boost).toBe(0.05);
  });

  it("parses negative boost", () => {
    const content = `---
name: demoted
description: A skill with negative boost
boost: -0.1
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.boost).toBe(-0.1);
  });

  it("ignores non-numeric boost", () => {
    const content = `---
name: bad-boost
description: A skill with bad boost
boost: high
---
body`;
    const { meta } = parseFrontmatter(content);
    expect(meta.boost).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Memory file parsing
// ---------------------------------------------------------------------------

describe("parseMemoryFile", () => {
  it("extracts sections with triggers", () => {
    const content = `# Project Memory

## Prefer Bun
Always use bun instead of npm

Triggers: "install dependencies", "npm install", "package manager"

## File Structure
The project uses src/ for source code

Triggers: "where are files", "project structure"
`;
    const sections = parseMemoryFile(content, "/test/memory.md");
    expect(sections).toHaveLength(2);
    expect(sections[0].name).toBe("Prefer Bun");
    expect(sections[0].queries).toEqual(["install dependencies", "npm install", "package manager"]);
    expect(sections[0].body).toContain("Always use bun");
    expect(sections[1].name).toBe("File Structure");
    expect(sections[1].queries).toHaveLength(2);
  });

  it("handles sections without triggers", () => {
    const content = `## No Triggers Here
Just some info about the project.
`;
    const sections = parseMemoryFile(content, "/test/memory.md");
    expect(sections).toHaveLength(1);
    expect(sections[0].queries).toEqual([]);
    expect(sections[0].body).toContain("Just some info");
  });

  it("skips headings with no content", () => {
    const content = `## Empty Section
`;
    const sections = parseMemoryFile(content, "/test/memory.md");
    expect(sections).toHaveLength(0);
  });

  it("handles singular Trigger: keyword", () => {
    const content = `## My Pref
Some content
Trigger: testing, debugging
`;
    const sections = parseMemoryFile(content, "/test/memory.md");
    expect(sections).toHaveLength(1);
    expect(sections[0].queries).toEqual(["testing", "debugging"]);
  });

  it("uses first body line as description", () => {
    const content = `## Important Rule
First line is the description.
Second line is extra detail.
`;
    const sections = parseMemoryFile(content, "/test/memory.md");
    expect(sections[0].description).toBe("First line is the description.");
  });

  it("returns empty array for no sections", () => {
    const content = "Just some text without headings.";
    const sections = parseMemoryFile(content, "/test/memory.md");
    expect(sections).toEqual([]);
  });

  it("parses frontmatter-based memory files", () => {
    const content = `---
name: destructive-git-ops
description: User handles destructive git operations manually
type: feedback
---

Never run destructive git commands.

**Why:** The user wants control over irreversible changes.`;
    const sections = parseMemoryFile(content, "/test/feedback_git.md");
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("destructive-git-ops");
    expect(sections[0].description).toBe("User handles destructive git operations manually");
    expect(sections[0].queries).toEqual([]);
    expect(sections[0].body).toContain("Never run destructive git commands");
  });

  it("parses frontmatter memory with queries", () => {
    const content = `---
name: prefer-pnpm
description: Always use pnpm instead of npm
queries:
  - "install dependencies"
  - "npm install"
---

Use pnpm for all package operations.`;
    const sections = parseMemoryFile(content, "/test/memory_pnpm.md");
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("prefer-pnpm");
    expect(sections[0].queries).toEqual(["install dependencies", "npm install"]);
  });

  it("derives name from filename when frontmatter lacks name", () => {
    const content = `---
description: A memory without a name field
---

Some content.`;
    const sections = parseMemoryFile(content, "/test/my-memory.md");
    expect(sections).toHaveLength(1);
    expect(sections[0].name).toBe("my-memory");
  });

  it("returns empty for frontmatter-only file with no body or queries", () => {
    const content = `---
name: empty-memory
description: Nothing here
---`;
    const sections = parseMemoryFile(content, "/test/empty.md");
    expect(sections).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Cosine similarity
// ---------------------------------------------------------------------------

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    expect(cosineSimilarity([1, 2, 3, 4], [1, 2, 3, 4])).toBeCloseTo(1.0);
  });

  it("returns 0 for orthogonal vectors", () => {
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0.0);
  });

  it("returns -1 for opposite vectors", () => {
    expect(cosineSimilarity([1, 0], [-1, 0])).toBeCloseTo(-1.0);
  });

  it("returns 0 for zero vectors", () => {
    expect(cosineSimilarity([0, 0], [1, 2])).toBe(0);
  });

  it("returns 0 for mismatched lengths", () => {
    expect(cosineSimilarity([1, 2], [1, 2, 3])).toBe(0);
  });

  it("handles non-unit vectors", () => {
    const sim = cosineSimilarity([3, 4], [6, 8]);
    expect(sim).toBeCloseTo(1.0);
  });
});

// ---------------------------------------------------------------------------
// SkillIndex build + search (mocked embeddings)
// ---------------------------------------------------------------------------

describe("SkillIndex", () => {
  let testDir: string;
  let cachePath: string;
  let mockProvider: EmbeddingProvider;
  const mockEmbed = vi.fn();

  function makeEmbeddings(count: number): number[][] {
    return Array.from({ length: count }, (_, i) =>
      Array.from({ length: 4 }, (_, j) => (j === i % 4 ? 1 : 0)),
    );
  }

  function makeScanDirs(baseDir: string): ScanDirs {
    return {
      skillDirs: [join(baseDir, "skills")],
      memoryDirs: [],
      ruleDirs: [],
    };
  }

  beforeEach(async () => {
    testDir = join(
      tmpdir(),
      `skill-index-test-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    );
    cachePath = join(testDir, "cache", "skill-router.json");
    await mkdir(join(testDir, "skills", "weather"), { recursive: true });
    await mkdir(join(testDir, "skills", "git"), { recursive: true });

    await writeFile(
      join(testDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get current weather and forecasts\n---\n# Weather\n\nFetch weather data.`,
    );
    await writeFile(
      join(testDir, "skills", "git", "SKILL.md"),
      `---\nname: git\ndescription: Git version control operations\n---\n# Git\n\nRun git commands.`,
    );

    mockEmbed.mockReset();
    mockProvider = { embed: mockEmbed };
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("builds an index from skills", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2));

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    expect(index.skillCount).toBe(2);
    expect(mockEmbed).toHaveBeenCalledTimes(1);
    expect(mockEmbed.mock.calls[0][0]).toHaveLength(2);
  });

  it("settles cache writes before repeated isolated teardown", async () => {
    const stressRoots: string[] = [];
    try {
      await Promise.all(
        Array.from({ length: 40 }, async (_, iteration) => {
          const root = join(testDir, `stress-${iteration}`);
          stressRoots.push(root);
          const skillDir = join(root, "skills", "fixture");
          await mkdir(skillDir, { recursive: true });
          await writeFile(
            join(skillDir, "SKILL.md"),
            `---\nname: fixture-${iteration}\ndescription: cleanup stress fixture\n---\n`,
          );
          const provider: EmbeddingProvider = {
            embed: async (texts) => texts.map(() => [1, 0, 0, 0]),
          };
          const index = new SkillIndex(
            { ...DEFAULT_CORE_CONFIG },
            provider,
            join(root, "cache", "skill-router.json"),
          );

          await index.build(makeScanDirs(root));
          await rm(root, { recursive: true, force: true });
          await expect(stat(root)).rejects.toMatchObject({ code: "ENOENT" });
        }),
      );
    } finally {
      await Promise.all(
        stressRoots.map((root) => rm(root, { recursive: true, force: true, maxRetries: 2 })),
      );
    }
  });

  it("uses frontmatter queries when present", async () => {
    await writeFile(
      join(testDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get weather\nqueries:\n  - "What is the weather?"\n  - "Will it rain?"\n  - "Temperature today"\n---\n# Weather`,
    );
    mockEmbed.mockResolvedValueOnce([
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [1, 0, 0, 0],
      [0, 1, 0, 0],
    ]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    expect(index.skillCount).toBe(2);
    expect(mockEmbed.mock.calls[0][0]).toHaveLength(4);
  });

  it("search returns results above threshold (absolute mode)", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[1, 0, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("what is the weather?", 3, 0.5);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("returns normalized sync-main and storm descriptions from search", async () => {
    const syncMain = await readFile(
      new URL("./fixtures/folded-frontmatter/sync-main.md", import.meta.url),
      "utf8",
    );
    const storm = await readFile(
      new URL("./fixtures/folded-frontmatter/storm.md", import.meta.url),
      "utf8",
    );
    await writeFile(join(testDir, "skills", "weather", "SKILL.md"), syncMain);
    await writeFile(join(testDir, "skills", "git", "SKILL.md"), storm);
    mockEmbed
      .mockResolvedValueOnce([
        [1, 0, 0, 0],
        [1, 0, 0, 0],
      ])
      .mockResolvedValueOnce([[1, 0, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));
    const results = await index.search("development workflow", 5, 0.5);

    for (const name of ["sync-main", "storm"]) {
      const result = results.find(({ skill }) => skill.name === name);
      expect(result?.skill.description.length).toBeGreaterThan(40);
      expect(result?.skill.description).not.toContain("\n");
      expect(result?.skill.description).not.toBe(">-");
    }
  });

  it("search filters results below threshold", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[1, 0, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("weather", 3, 0.65);
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("excludes retired entries by default and allows explicit history search", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, "old-policy.md"),
      `---\nname: old-policy\ndescription: RETIRED 2026-06-11 — historical policy\nstatus: retired\n---\nOld policy body.`,
    );

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(3)).mockResolvedValueOnce([[0, 0, 1, 0]]);
    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build({
      skillDirs: [join(testDir, "skills")],
      memoryDirs: [],
      ruleDirs: [rulesDir],
    });

    expect(await index.search("old policy", 5, 0.5)).toEqual([]);
    expect(index.skillCount).toBe(3);
    expect(await index.readSkillContent(join(rulesDir, "old-policy.md"))).toContain(
      "Old policy body.",
    );
  });

  it("search filters by type", async () => {
    await writeFile(
      join(testDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get weather\ntype: memory\n---\nWeather info.`,
    );

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[0.5, 0.5, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("anything", 3, 0.0, ["skill"]);
    const names = results.map((r) => r.skill.name);
    expect(names).not.toContain("weather");
    expect(names).toContain("git");
  });

  it("search respects topK limit", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[1, 1, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("anything", 1, 0.0);
    expect(results).toHaveLength(1);
  });

  it("readSkillContent strips frontmatter and returns body", async () => {
    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    const location = join(testDir, "skills", "weather", "SKILL.md");
    const content = await index.readSkillContent(location);
    expect(content).toContain("Fetch weather data");
    expect(content).not.toContain("---");
  });

  it("handles empty workspace gracefully", async () => {
    const emptyDir = join(tmpdir(), `empty-workspace-${Date.now()}`);
    await mkdir(emptyDir, { recursive: true });

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build({ skillDirs: [join(emptyDir, "skills")], memoryDirs: [], ruleDirs: [] });

    expect(index.skillCount).toBe(0);
    expect(mockEmbed).not.toHaveBeenCalled();

    await rm(emptyDir, { recursive: true, force: true });
  });

  it("indexes rule files", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, "prefer-pnpm.md"),
      `---
name: prefer-pnpm
description: "Use pnpm instead of npm"
type: rule
one-liner: "Use pnpm, not npm."
queries:
  - "install dependencies"
  - "npm install"
---
Always use pnpm for all package management.`,
    );

    // 2 skills + 1 rule (2 queries) = 4 embeddings
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(4));

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build({
      skillDirs: [join(testDir, "skills")],
      memoryDirs: [],
      ruleDirs: [rulesDir],
    });

    expect(index.skillCount).toBe(3);
  });

  it("indexes rule files without frontmatter using filename as name", async () => {
    const rulesDir = join(testDir, "rules");
    await mkdir(rulesDir, { recursive: true });
    await writeFile(
      join(rulesDir, "no-console-log.md"),
      "Do not use console.log in production code. Use a proper logger instead.",
    );

    // 2 skills + 1 rule = 3 embeddings
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(3));

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build({
      skillDirs: [join(testDir, "skills")],
      memoryDirs: [],
      ruleDirs: [rulesDir],
    });

    expect(index.skillCount).toBe(3);
  });

  it("skips SKILL.md files with missing name or description", async () => {
    await writeFile(
      join(testDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\n---\n# Missing description`,
    );
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(1));

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    expect(index.skillCount).toBe(1);
  });

  it("needsRebuild returns true initially", () => {
    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    expect(index.needsRebuild()).toBe(true);
  });

  it("needsRebuild returns false right after build", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2));

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    expect(index.needsRebuild()).toBe(false);
  });

  it("relative scoring mode drops results far below best", async () => {
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[1, 0, 0, 0]]); // perfect match on first skill only

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("weather", 3, 0.3, undefined, "relative", 0.05);
    // Only the perfect match should survive (score 1.0), second skill scores 0
    expect(results).toHaveLength(1);
    expect(results[0].score).toBeCloseTo(1.0);
  });

  it("relative scoring returns nothing if best is below floor", async () => {
    // Use orthogonal query vector so all scores are 0
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[0, 0, 1, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    // Both skills have embeddings [1,0,0,0] and [0,1,0,0]; query is [0,0,1,0] → cosine 0
    const results = await index.search("nope", 3, 0.5, undefined, "relative", 0.1);
    expect(results).toHaveLength(0);
  });

  it("search returns bestQueryIndex (argmax of similarities)", async () => {
    // Weather skill with 3 queries → 3 embeddings, git skill with 1 query → 1 embedding
    await writeFile(
      join(testDir, "skills", "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get weather\nqueries:\n  - "What is the weather?"\n  - "Will it rain?"\n  - "Temperature today"\n---\n# Weather`,
    );
    // Scan order is alphabetical: git (1 query) then weather (3 queries) = 4 total
    // git q0=[1,0,0,0], weather q0=[0,1,0,0], weather q1=[0,0,1,0], weather q2=[0,0,0,1]
    // Query [0,0,1,0] → weather similarities: q0=0, q1=1, q2=0 → bestQueryIndex=1
    mockEmbed
      .mockResolvedValueOnce([
        [1, 0, 0, 0], // git q0
        [0, 1, 0, 0], // weather q0
        [0, 0, 1, 0], // weather q1 ← best match
        [0, 0, 0, 1], // weather q2
      ])
      .mockResolvedValueOnce([[0, 0, 1, 0]]); // search query

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("temperature", 3, 0.5);
    const weather = results.find((r) => r.skill.name === "weather");
    expect(weather).toBeDefined();
    expect(weather!.bestQueryIndex).toBe(1);
  });

  it("boost affects ranking", async () => {
    // Give git a boost that pushes it above weather
    await writeFile(
      join(testDir, "skills", "git", "SKILL.md"),
      `---\nname: git\ndescription: Git version control operations\nboost: 0.6\n---\n# Git\n\nRun git commands.`,
    );
    // Scan order: git first, weather second
    // Git embedding: [1,0,0,0], Weather embedding: [0,1,0,0]
    // Query: [0.3,0.7,0,0] → git cosine ~0.39, weather cosine ~0.92
    // Without boost: weather wins. With boost 0.6: git = 0.39+0.6 = 0.99 > 0.92
    mockEmbed
      .mockResolvedValueOnce([
        [1, 0, 0, 0], // git
        [0, 1, 0, 0], // weather
      ])
      .mockResolvedValueOnce([[0.3, 0.7, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("query", 3, 0.0);
    expect(results[0].skill.name).toBe("git");
  });

  it("deduplicates search results by skill name, keeping highest score", async () => {
    // Simulate the same skill indexed from two different directories
    // (e.g. original location + sync copy). Both have the same name but
    // different file paths, so build() treats them as separate entries.
    const syncDir = join(testDir, "sync-skills");
    await mkdir(join(syncDir, "weather"), { recursive: true });
    await writeFile(
      join(syncDir, "weather", "SKILL.md"),
      `---\nname: weather\ndescription: Get current weather and forecasts\n---\n# Weather\n\nFetch weather data.`,
    );

    // Build with two skill directories that both contain a "weather" skill
    // 3 skills total: weather (original), git, weather (sync copy)
    // Embeddings: weather1=[1,0,0,0], git=[0,1,0,0], weather2=[0,0,1,0]
    mockEmbed.mockResolvedValueOnce([
      [1, 0, 0, 0], // git (alphabetical: git before weather)
      [0, 1, 0, 0], // weather (original)
      [0, 0, 1, 0], // weather (sync)
    ]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build({
      skillDirs: [join(testDir, "skills"), syncDir],
      memoryDirs: [],
      ruleDirs: [],
    });

    expect(index.skillCount).toBe(3); // both copies indexed

    // Search with a query that matches the original weather better than the sync copy
    // Query: [0,1,0,0] → git=0, weather(original)=1.0, weather(sync)=0
    mockEmbed.mockResolvedValueOnce([[0, 1, 0, 0]]);

    const results = await index.search("what is the weather?", 5, 0.0);

    // Should only get 2 results (git + one weather), not 3
    const weatherResults = results.filter((r) => r.skill.name === "weather");
    expect(weatherResults).toHaveLength(1);
    expect(weatherResults[0].score).toBeCloseTo(1.0); // the higher-scoring copy
    expect(results).toHaveLength(2); // weather + git
  });

  it("survives orphaned v3 cache keys when registry loses a root", async () => {
    const skillsDir = join(testDir, "skills");
    const syncSkillsDir = join(testDir, "sync", "skills");
    await mkdir(join(syncSkillsDir, "orphaned"), { recursive: true });
    await writeFile(
      join(syncSkillsDir, "orphaned", "SKILL.md"),
      `---\nname: orphaned\ndescription: sync-only skill\n---\nbody`,
    );

    const registryWithSync = buildScanRoots(
      {
        cwd: testDir,
        harness: "grok",
        syncEnabled: true,
        syncRepoDir: join(testDir, "sync"),
        globalSkillsDirs: [skillsDir],
        globalRulesDirs: [],
        projectSkillsDir: join(testDir, ".grok", "skills"),
        projectRulesDir: join(testDir, ".grok", "rules"),
      },
      { skillDirs: [skillsDir, syncSkillsDir], memoryDirs: [], ruleDirs: [] },
    );

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(3));

    const warn = vi.fn();
    const index1 = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath, {
      registry: registryWithSync,
      warn,
    });
    await index1.build({ skillDirs: [skillsDir, syncSkillsDir], memoryDirs: [], ruleDirs: [] });
    expect(index1.skillCount).toBe(3);

    const registryNoSync = buildScanRoots(
      {
        cwd: testDir,
        harness: "grok",
        syncEnabled: false,
        globalSkillsDirs: [skillsDir],
        globalRulesDirs: [],
        projectSkillsDir: join(testDir, ".grok", "skills"),
        projectRulesDir: join(testDir, ".grok", "rules"),
      },
      { skillDirs: [skillsDir], memoryDirs: [], ruleDirs: [] },
    );

    // Seed v3 cache with an orphaned sync-skills key (registry no longer has that root)
    await saveCache(cachePath, {
      version: 3,
      embeddingModel: DEFAULT_CORE_CONFIG.embeddingModel,
      skills: {
        "memex://sync-skills/orphaned/SKILL.md": {
          name: "orphaned",
          description: "sync-only skill",
          queries: ["sync-only skill"],
          embeddings: [[1, 0, 0, 0]],
          mtime: 1,
          type: "skill",
        },
      },
    });

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2));
    const index2 = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath, {
      registry: registryNoSync,
      warn,
    });

    await expect(
      index2.build({ skillDirs: [skillsDir], memoryDirs: [], ruleDirs: [] }),
    ).resolves.toBeUndefined();
    expect(index2.skillCount).toBe(2);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("sync-skills"));
  });

  it("readSkillContent resolves portable memory sections with hash in name", async () => {
    const memoryDir = join(testDir, "memory");
    await mkdir(memoryDir, { recursive: true });
    await writeFile(
      join(memoryDir, "note.md"),
      `## Part#Two
Description for section with hash.

Section body with a literal hash in the name.`,
    );

    const registry = buildScanRoots(
      {
        cwd: testDir,
        harness: "grok",
        globalSkillsDirs: [join(testDir, "skills")],
        globalRulesDirs: [],
        projectSkillsDir: join(testDir, ".grok", "skills"),
        projectRulesDir: join(testDir, ".grok", "rules"),
      },
      { skillDirs: [join(testDir, "skills")], memoryDirs: [memoryDir], ruleDirs: [] },
    );

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(1));

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath, { registry });
    await index.build({
      skillDirs: [join(testDir, "skills")],
      memoryDirs: [memoryDir],
      ruleDirs: [],
    });

    const memoryFile = join(memoryDir, "note.md");
    const baseHandle = encodePortableLocation(registry, memoryFile);
    expect(baseHandle).not.toBeNull();
    const location = `${baseHandle}#${encodeFragment("Part#Two")}`;

    const content = await index.readSkillContent(location);
    expect(content).toContain("Section body with a literal hash in the name.");
  });

  it("readSkillContent round-trips memory section names containing hash", async () => {
    const memDir = join(testDir, "memories");
    await mkdir(memDir, { recursive: true });
    await writeFile(
      join(memDir, "note.md"),
      `## Part#Two
Section body with hash in name.

Triggers: "hash section"
`,
    );

    const registry = buildScanRoots(
      {
        cwd: testDir,
        harness: "grok",
        globalSkillsDirs: [join(testDir, "skills")],
        globalRulesDirs: [],
        projectSkillsDir: join(testDir, ".grok", "skills"),
        projectRulesDir: join(testDir, ".grok", "rules"),
      },
      {
        skillDirs: [join(testDir, "skills")],
        memoryDirs: [memDir],
        ruleDirs: [],
      },
    );

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(3)).mockResolvedValueOnce([[1, 0, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath, { registry });
    await index.build({
      skillDirs: [join(testDir, "skills")],
      memoryDirs: [memDir],
      ruleDirs: [],
    });

    const results = await index.search("hash section", 3, 0.0);
    const hit = results.find((r) => r.skill.name === "Part#Two");
    expect(hit).toBeDefined();
    expect(hit!.skill.location).toContain("%23");

    const content = await index.readSkillContent(hit!.skill.location);
    expect(content).toContain("Section body with hash in name");
  });

  it("escape grammar matrix: index → search → readSkillContent", async () => {
    const memoryDir = join(testDir, "memory");
    const sharpDir = join(testDir, "skills", "c#sharp");
    await mkdir(memoryDir, { recursive: true });
    await mkdir(sharpDir, { recursive: true });
    await writeFile(
      join(memoryDir, "note.md"),
      `## Part#Two
Hash section body.

Triggers: "hash section"

## A%23B
Percent-encoded section body.

Triggers: "percent section"

## 100% done
Percent sign section body.

Triggers: "percent sign"
`,
    );
    await writeFile(
      join(sharpDir, "SKILL.md"),
      `---\nname: sharp-skill\ndescription: Skill under c#sharp dir\n---\nSharp dir body.`,
    );

    const skillsDir = join(testDir, "skills");
    const registry = buildScanRoots(
      {
        cwd: testDir,
        harness: "grok",
        globalSkillsDirs: [skillsDir],
        globalRulesDirs: [],
        projectSkillsDir: join(testDir, ".grok", "skills"),
        projectRulesDir: join(testDir, ".grok", "rules"),
      },
      { skillDirs: [skillsDir], memoryDirs: [memoryDir], ruleDirs: [] },
    );

    // 3 skills + 3 memory sections = 6 embeddings; uniform vectors so search hits by name
    const uniform = Array.from({ length: 6 }, () => [1, 0, 0, 0] as number[]);
    mockEmbed
      .mockResolvedValueOnce(uniform)
      .mockResolvedValueOnce([[1, 0, 0, 0]])
      .mockResolvedValueOnce([[1, 0, 0, 0]])
      .mockResolvedValueOnce([[1, 0, 0, 0]])
      .mockResolvedValueOnce([[1, 0, 0, 0]]);

    const withRegistry = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath, {
      registry,
    });
    await withRegistry.build({
      skillDirs: [skillsDir],
      memoryDirs: [memoryDir],
      ruleDirs: [],
    });

    const hashHit = (await withRegistry.search("hash section", 10, 0.0)).find(
      (r) => r.skill.name === "Part#Two",
    );
    expect(hashHit).toBeDefined();
    expect(hashHit!.skill.location).toContain("%23");
    expect(await withRegistry.readSkillContent(hashHit!.skill.location)).toContain(
      "Hash section body",
    );

    const pctHit = (await withRegistry.search("percent section", 10, 0.0)).find(
      (r) => r.skill.name === "A%23B",
    );
    expect(pctHit).toBeDefined();
    expect(pctHit!.skill.location).toContain("%2523");
    expect(await withRegistry.readSkillContent(pctHit!.skill.location)).toContain(
      "Percent-encoded section body",
    );

    const pctSignHit = (await withRegistry.search("percent sign", 10, 0.0)).find(
      (r) => r.skill.name === "100% done",
    );
    expect(pctSignHit).toBeDefined();
    expect(pctSignHit!.skill.location).toContain("%25");
    expect(await withRegistry.readSkillContent(pctSignHit!.skill.location)).toContain(
      "Percent sign section body",
    );

    const sharpHit = (await withRegistry.search("sharp", 10, 0.0)).find(
      (r) => r.skill.name === "sharp-skill",
    );
    expect(sharpHit).toBeDefined();
    expect(sharpHit?.skill.location).toMatch(/c%23sharp\/SKILL\.md$/);
    expect(await withRegistry.readSkillContent(sharpHit!.skill.location)).toContain(
      "Sharp dir body",
    );

    // Phase-1 no-registry path: literal %23 section name must round-trip
    mockEmbed.mockResolvedValueOnce(makeEmbeddings(3));
    const noRegistry = new SkillIndex(
      { ...DEFAULT_CORE_CONFIG },
      mockProvider,
      join(testDir, "cache2", "skill-router.json"),
    );
    await noRegistry.build({
      skillDirs: [skillsDir],
      memoryDirs: [memoryDir],
      ruleDirs: [],
    });
    const absKey = `${join(memoryDir, "note.md")}#${encodeFragment("A%23B")}`;
    expect(await noRegistry.readSkillContent(absKey)).toContain("Percent-encoded section body");
  });

  it("stores portable memex:// handles when registry is configured", async () => {
    const skillsDir = join(testDir, "skills");
    const registry = buildScanRoots(
      {
        cwd: testDir,
        harness: "grok",
        globalSkillsDirs: [skillsDir],
        globalRulesDirs: [],
        projectSkillsDir: join(testDir, ".grok", "skills"),
        projectRulesDir: join(testDir, ".grok", "rules"),
      },
      { skillDirs: [skillsDir], memoryDirs: [], ruleDirs: [] },
    );

    mockEmbed.mockResolvedValueOnce(makeEmbeddings(2)).mockResolvedValueOnce([[1, 0, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath, { registry });
    await index.build(makeScanDirs(testDir));

    const results = await index.search("weather", 3, 0.0);
    for (const r of results) {
      expect(r.skill.location).toMatch(/^memex:\/\//);
      expect(r.skill.location).not.toContain(testDir);
    }

    const weather = results.find((r) => r.skill.name === "weather");
    expect(weather).toBeDefined();
    const content = await index.readSkillContent(weather!.skill.location);
    expect(content).toContain("Fetch weather data");
  });

  it("boost affects threshold crossing", async () => {
    // Skill just below threshold can cross it with boost
    await writeFile(
      join(testDir, "skills", "git", "SKILL.md"),
      `---\nname: git\ndescription: Git version control operations\nboost: 0.3\n---\n# Git\n\nRun git commands.`,
    );
    // Scan order: git first, weather second
    // git embedding=[1,0,0,0], weather embedding=[0,1,0,0]
    // Query: [0,1,0,0] → git raw=0.0, weather raw=1.0
    // With boost 0.3: git = 0.3 (crosses threshold 0.2)
    mockEmbed
      .mockResolvedValueOnce([
        [1, 0, 0, 0], // git
        [0, 1, 0, 0], // weather
      ])
      .mockResolvedValueOnce([[0, 1, 0, 0]]);

    const index = new SkillIndex({ ...DEFAULT_CORE_CONFIG }, mockProvider, cachePath);
    await index.build(makeScanDirs(testDir));

    const results = await index.search("weather", 3, 0.2);
    const gitResult = results.find((r) => r.skill.name === "git");
    expect(gitResult).toBeDefined();
    expect(gitResult!.score).toBeCloseTo(0.3);
  });
});

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildScanRoots,
  decodeFragment,
  decodePortableLocation,
  decodePortableLocationResolved,
  encodeFragment,
  encodePortableLocation,
  escapePortableText,
  resolvePortableLocation,
  type ScanRootContext,
  splitPortableHandle,
  unescapePortableText,
} from "../src/portable-location.ts";
import { LOCATION_ROUND_TRIP_GOLDEN } from "./fixtures/location-round-trip-golden.ts";

const FIXTURE_CTX: ScanRootContext = {
  cwd: "/srv/example-user/project",
  syncEnabled: true,
  syncRepoDir: "/srv/example-user/.memex/sync",
  globalSkillsDirs: ["/srv/example-user/.grok/skills", "/srv/example-user/.claude/skills"],
  globalRulesDirs: ["/srv/example-user/.grok/rules"],
  projectSkillsDir: "/srv/example-user/project/.grok/skills",
  projectRulesDir: "/srv/example-user/project/.grok/rules",
  harness: "grok",
};

function fixtureRegistry() {
  return buildScanRoots(FIXTURE_CTX, {
    skillDirs: [
      "/srv/example-user/.grok/skills",
      "/srv/example-user/project/.grok/skills",
      "/srv/example-user/.memex/sync/skills",
      "/opt/extra/skills",
    ],
    memoryDirs: ["/srv/example-user/project/.grok/memories"],
    ruleDirs: ["/srv/example-user/.grok/rules", "/srv/example-user/.memex/sync/rules"],
  });
}

describe("portable-location", () => {
  let testDir: string;

  beforeEach(async () => {
    testDir = join(tmpdir(), `portable-loc-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(testDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("round-trips golden vectors", () => {
    const registry = fixtureRegistry();
    for (const { absolute, handle } of LOCATION_ROUND_TRIP_GOLDEN) {
      expect(encodePortableLocation(registry, absolute)).toBe(handle);
      expect(decodePortableLocation(registry, handle)).toBe(absolute);
    }
  });

  it("stable unclassified keys survive unrelated root reorder", () => {
    const extraA = "/opt/a/skills";
    const extraB = "/opt/b/skills";
    const spec = {
      skillDirs: [FIXTURE_CTX.globalSkillsDirs[0], extraB, extraA],
      memoryDirs: [] as string[],
      ruleDirs: [] as string[],
    };
    const roots1 = buildScanRoots(FIXTURE_CTX, spec);
    const roots2 = buildScanRoots(FIXTURE_CTX, {
      ...spec,
      skillDirs: [extraA, FIXTURE_CTX.globalSkillsDirs[0], extraB],
    });

    const keyA1 = encodePortableLocation(roots1, join(extraA, "foo/SKILL.md"));
    const keyA2 = encodePortableLocation(roots2, join(extraA, "foo/SKILL.md"));
    const keyB1 = encodePortableLocation(roots1, join(extraB, "bar/SKILL.md"));
    const keyB2 = encodePortableLocation(roots2, join(extraB, "bar/SKILL.md"));

    expect(keyA1).toBe(keyA2);
    expect(keyB1).toBe(keyB2);
    expect(keyA1).toContain("skill-unclassified-");
    expect(keyB1).toContain("skill-unclassified-");
    expect(keyA1).not.toBe(keyB1);
  });

  it("fail-open encode returns null for paths outside registry", () => {
    const registry = fixtureRegistry();
    const warn = vi.fn();
    expect(encodePortableLocation(registry, "/etc/passwd", warn)).toBeNull();
    expect(warn).toHaveBeenCalled();
  });

  it("rejects traversal on decode (fail-closed)", () => {
    const registry = fixtureRegistry();
    const cases = [
      "memex://grok-global/../escape/SKILL.md",
      "memex://grok-global/foo/../../etc/passwd",
      "memex://grok-global//etc/passwd",
      "memex://unknown-root/foo.md",
    ];
    for (const handle of cases) {
      expect(() => decodePortableLocation(registry, handle)).toThrow();
    }
  });

  it("splitPortableHandle uses lastIndexOf for fragment", () => {
    const handle = "memex://sync-skills/foo.md#Section%23Name";
    const { body, fragment } = splitPortableHandle(handle);
    expect(body).toBe("memex://sync-skills/foo.md");
    expect(fragment).toBe("Section#Name");
  });

  it("escapePortableText is injective for # and %", () => {
    expect(escapePortableText("a#b")).toBe("a%23b");
    expect(escapePortableText("A%23B")).toBe("A%2523B");
    expect(unescapePortableText(escapePortableText("Part#Two"))).toBe("Part#Two");
    expect(unescapePortableText(escapePortableText("A%23B"))).toBe("A%23B");
    expect(encodeFragment).toBe(escapePortableText);
    expect(decodeFragment).toBe(unescapePortableText);
  });

  it("round-trips section names containing hash or percent", () => {
    const registry = fixtureRegistry();
    const file = "/srv/example-user/project/.grok/memories/note.md";
    const base = encodePortableLocation(registry, file);
    expect(base).toBe("memex://memory-unclassified-411d39e1/note.md");

    for (const sectionName of ["Part#Two", "A%23B"] as const) {
      const handle = `${base}#${encodeFragment(sectionName)}`;
      const resolved = decodePortableLocationResolved(registry, handle);
      expect(resolved.filePath).toBe(file);
      expect(resolved.sectionName).toBe(sectionName);
    }
  });

  it("round-trips absolute paths with literal hash in directory names", () => {
    const registry = fixtureRegistry();
    for (const absolute of [
      "/srv/example-user/.grok/skills/c#/SKILL.md",
      "/srv/example-user/.grok/skills/c#sharp/SKILL.md",
    ]) {
      const handle = encodePortableLocation(registry, absolute);
      expect(handle).toContain("%23");
      expect(decodePortableLocation(registry, handle)).toBe(absolute);
      expect(decodePortableLocationResolved(registry, handle).filePath).toBe(absolute);
      expect(decodePortableLocationResolved(registry, handle).sectionName).toBeUndefined();
    }
  });

  it("resolvePortableLocation accepts absolute paths with deprecation warn", () => {
    const registry = fixtureRegistry();
    const warn = vi.fn();
    const abs = "/srv/example-user/.grok/skills/weather/SKILL.md";
    expect(resolvePortableLocation(registry, abs, { warn })).toBe(abs);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("deprecated"));
  });

  it("containment blocks symlink-style escape via dot-dot rel", async () => {
    const root = join(testDir, "skills");
    const nested = join(root, "nested");
    await mkdir(nested, { recursive: true });
    await writeFile(join(nested, "SKILL.md"), "x");

    const registry = buildScanRoots(
      {
        ...FIXTURE_CTX,
        cwd: testDir,
        projectSkillsDir: root,
        harness: "grok",
        globalSkillsDirs: [],
        globalRulesDirs: [],
      },
      { skillDirs: [root], memoryDirs: [], ruleDirs: [] },
    );

    expect(() =>
      decodePortableLocation(registry, "memex://grok-project/../../outside/SKILL.md"),
    ).toThrow(/escapes scan root/);
  });

  it("does not misclassify .grokfoo paths as grok-global", () => {
    const grokfoo = "/x/.grokfoo/skills";
    const registry = buildScanRoots(
      {
        ...FIXTURE_CTX,
        globalSkillsDirs: [grokfoo, "/srv/example-user/.grok/skills"],
      },
      { skillDirs: [grokfoo, "/srv/example-user/.grok/skills"], memoryDirs: [], ruleDirs: [] },
    );
    const grokfooHandle = encodePortableLocation(registry, join(grokfoo, "x/SKILL.md"));
    const realGrok = encodePortableLocation(registry, "/srv/example-user/.grok/skills/y/SKILL.md");
    expect(grokfooHandle).toMatch(/^memex:\/\/skill-unclassified-/);
    expect(realGrok).toBe("memex://grok-global/y/SKILL.md");
  });

  it("rootKeys are lowercase-canonical", () => {
    const registry = fixtureRegistry();
    for (const { key } of registry) {
      expect(key).toBe(key.toLowerCase());
      expect(key).not.toMatch(/[A-Z]/);
    }
  });
});

import {
  lstat,
  mkdir,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { git } from "../src/git-helpers.ts";
import {
  applyProjection,
  commitOriginPaths,
  defaultOriginRoot,
  installLegacyOriginCompatSymlink,
  isPathInsideRoot,
  materializeEntry,
  migrateOriginToDefault,
  planProjection,
  resolveOriginRoot,
  resolveUnderOrigin,
} from "../src/origin.ts";

describe("origin path helpers", () => {
  it("resolveUnderOrigin rejects absolute and traversal", () => {
    const root = "/tmp/origin-root";
    expect(() => resolveUnderOrigin(root, "/etc/passwd")).toThrow(/absolute/);
    expect(() => resolveUnderOrigin(root, "../etc/passwd")).toThrow(/escapes/);
    expect(resolveUnderOrigin(root, "rules/a.md")).toBe(join(root, "rules/a.md"));
  });

  it("isPathInsideRoot is prefix-safe", () => {
    expect(isPathInsideRoot("/tmp/origin", "/tmp/origin")).toBe(true);
    expect(isPathInsideRoot("/tmp/origin", "/tmp/origin/rules")).toBe(true);
    expect(isPathInsideRoot("/tmp/origin", "/tmp/origin-evil")).toBe(false);
    expect(isPathInsideRoot("/tmp/origin", "/tmp/other")).toBe(false);
  });
});

describe("resolveOriginRoot", () => {
  let home: string;

  beforeEach(async () => {
    home = join(tmpdir(), `memex-origin-home-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("prefers explicit root", async () => {
    const explicit = join(home, "custom-origin");
    await mkdir(explicit);
    const r = await resolveOriginRoot({ root: explicit, homeDir: home, env: {} });
    expect(r.root).toBe(explicit);
    expect(r.source).toBe("explicit");
    expect(r.exists).toBe(true);
  });

  it("expands ~/ in explicit root", async () => {
    const r = await resolveOriginRoot({ root: "~/my-origin", homeDir: home, env: {} });
    expect(r.root).toBe(join(home, "my-origin"));
    expect(r.source).toBe("explicit");
  });

  it("prefers MEMEX_ORIGIN env over filesystem discovery", async () => {
    const envPath = join(home, "from-env");
    await mkdir(envPath);
    await mkdir(join(home, ".memex"));
    const r = await resolveOriginRoot({
      homeDir: home,
      env: { MEMEX_ORIGIN: envPath },
    });
    expect(r.root).toBe(envPath);
    expect(r.source).toBe("env");
  });

  it("discovers ~/.memex before XDG and legacy", async () => {
    await mkdir(join(home, ".memex"));
    await mkdir(join(home, ".local", "share", "memex"), { recursive: true });
    await mkdir(join(home, ".local", "share", "memex-claude"), { recursive: true });
    const r = await resolveOriginRoot({ homeDir: home, env: {} });
    expect(r.root).toBe(join(home, ".memex"));
    expect(r.source).toBe("default");
  });

  it("falls back to XDG memex when default missing", async () => {
    await mkdir(join(home, ".local", "share", "memex"), { recursive: true });
    await mkdir(join(home, ".local", "share", "memex-claude"), { recursive: true });
    const r = await resolveOriginRoot({ homeDir: home, env: {} });
    expect(r.root).toBe(join(home, ".local", "share", "memex"));
    expect(r.source).toBe("xdg");
  });

  it("falls back to legacy memex-claude", async () => {
    await mkdir(join(home, ".local", "share", "memex-claude"), { recursive: true });
    const r = await resolveOriginRoot({ homeDir: home, env: {} });
    expect(r.root).toBe(join(home, ".local", "share", "memex-claude"));
    expect(r.source).toBe("legacy-claude");
  });

  it("returns product default when nothing exists", async () => {
    const r = await resolveOriginRoot({ homeDir: home, env: {} });
    expect(r.root).toBe(defaultOriginRoot(home));
    expect(r.source).toBe("default");
    expect(r.exists).toBe(false);
  });
});

describe("planProjection / applyProjection", () => {
  let root: string;
  let origin: string;
  let harness: string;

  beforeEach(async () => {
    root = join(tmpdir(), `memex-proj-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    origin = join(root, "origin");
    harness = join(root, "harness-rules");
    await mkdir(join(origin, "rules"), { recursive: true });
    await mkdir(join(origin, "skills", "weather"), { recursive: true });
    await writeFile(join(origin, "rules", "alpha.md"), "# alpha\n", "utf-8");
    await writeFile(join(origin, "rules", "beta.md"), "# beta\n", "utf-8");
    await writeFile(join(origin, "skills", "weather", "SKILL.md"), "# weather\n", "utf-8");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("creates absolute symlinks for missing targets (files)", async () => {
    const plan = await planProjection(origin, [
      {
        id: "test-rules",
        targetDir: harness,
        originRelDir: "rules",
        entryKind: "files",
      },
    ]);
    expect(plan.conflicts).toEqual([]);
    expect(plan.links.map((l) => l.action).sort()).toEqual(["create", "create"]);

    const result = await applyProjection(plan);
    expect(result.linked).toBe(2);
    expect(result.conflicts).toEqual([]);

    const alphaLink = join(harness, "alpha.md");
    const target = await readlink(alphaLink);
    expect(target).toBe(join(origin, "rules", "alpha.md"));
    expect(target.startsWith("/")).toBe(true); // absolute
    const body = await readFile(alphaLink, "utf-8");
    expect(body).toBe("# alpha\n");
  });

  it("no-ops when symlink already points at origin entry", async () => {
    await mkdir(harness, { recursive: true });
    const originAlpha = join(origin, "rules", "alpha.md");
    await symlink(originAlpha, join(harness, "alpha.md"));
    await symlink(join(origin, "rules", "beta.md"), join(harness, "beta.md"));

    const plan = await planProjection(origin, [
      {
        id: "test-rules",
        targetDir: harness,
        originRelDir: "rules",
        entryKind: "files",
      },
    ]);
    expect(plan.links.every((l) => l.action === "noop")).toBe(true);
    const result = await applyProjection(plan);
    expect(result.linked).toBe(0);
    expect(result.skipped).toBe(2);
  });

  it("relinks managed symlink that points at a different origin entry", async () => {
    await mkdir(harness, { recursive: true });
    // alpha target currently points at beta origin file
    await symlink(join(origin, "rules", "beta.md"), join(harness, "alpha.md"));
    await symlink(join(origin, "rules", "beta.md"), join(harness, "beta.md"));

    const plan = await planProjection(origin, [
      {
        id: "test-rules",
        targetDir: harness,
        originRelDir: "rules",
        entryKind: "files",
      },
    ]);
    const alpha = plan.links.find((l) => l.targetPath.endsWith("alpha.md"));
    expect(alpha?.action).toBe("relink");

    await applyProjection(plan);
    expect(await readlink(join(harness, "alpha.md"))).toBe(join(origin, "rules", "alpha.md"));
  });

  it("fail-closed: does not clobber a real file; partial apply continues", async () => {
    await mkdir(harness, { recursive: true });
    await writeFile(join(harness, "alpha.md"), "LOCAL ONLY\n", "utf-8");
    // beta missing → should still be linkable

    const plan = await planProjection(origin, [
      {
        id: "test-rules",
        targetDir: harness,
        originRelDir: "rules",
        entryKind: "files",
      },
    ]);
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0].reason).toBe("real-file");
    expect(plan.conflicts[0].targetPath).toBe(join(harness, "alpha.md"));
    expect(plan.links.filter((l) => l.action === "create")).toHaveLength(1);

    const result = await applyProjection(plan);
    expect(result.linked).toBe(1);
    expect(result.conflicts).toHaveLength(1);

    // real file survives
    expect(await readFile(join(harness, "alpha.md"), "utf-8")).toBe("LOCAL ONLY\n");
    const st = await lstat(join(harness, "alpha.md"));
    expect(st.isSymbolicLink()).toBe(false);

    // beta was linked
    expect(await readlink(join(harness, "beta.md"))).toBe(join(origin, "rules", "beta.md"));
  });

  it("fail-closed: foreign symlink outside origin is a conflict", async () => {
    await mkdir(harness, { recursive: true });
    const outside = join(root, "outside.md");
    await writeFile(outside, "nope\n", "utf-8");
    await symlink(outside, join(harness, "alpha.md"));

    const plan = await planProjection(origin, [
      {
        id: "test-rules",
        targetDir: harness,
        originRelDir: "rules",
        entryKind: "files",
      },
    ]);
    const alphaConflict = plan.conflicts.find((c) => c.targetPath.endsWith("alpha.md"));
    expect(alphaConflict?.reason).toBe("foreign-symlink");
  });

  it("projects skill-dirs as directory symlinks", async () => {
    const skillHarness = join(root, "harness-skills");
    const plan = await planProjection(origin, [
      {
        id: "test-skills",
        targetDir: skillHarness,
        originRelDir: "skills",
        entryKind: "skill-dirs",
      },
    ]);
    expect(plan.links).toHaveLength(1);
    expect(plan.links[0].action).toBe("create");
    await applyProjection(plan);
    const link = join(skillHarness, "weather");
    expect(await readlink(link)).toBe(join(origin, "skills", "weather"));
    expect(await readFile(join(link, "SKILL.md"), "utf-8")).toBe("# weather\n");
  });
});

describe("materializeEntry", () => {
  let origin: string;

  beforeEach(async () => {
    origin = join(tmpdir(), `memex-mat-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(origin, { recursive: true });
  });

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true });
  });

  it("creates a new rule under origin", async () => {
    const r = await materializeEntry(origin, {
      kind: "rule",
      originRelPath: "rules/new-rule.md",
      content: "---\nname: new-rule\n---\nbody\n",
    });
    expect(r.status).toBe("created");
    if (r.status === "conflict") throw new Error("unexpected conflict");
    expect(await readFile(r.absPath, "utf-8")).toContain("new-rule");
  });

  it("updates when content changes", async () => {
    await materializeEntry(origin, {
      kind: "rule",
      originRelPath: "rules/x.md",
      content: "v1\n",
    });
    const r = await materializeEntry(origin, {
      kind: "rule",
      originRelPath: "rules/x.md",
      content: "v2\n",
    });
    expect(r.status).toBe("updated");
  });

  it("unchanged when content matches", async () => {
    await materializeEntry(origin, {
      kind: "memory",
      originRelPath: "projects/foo/memory/n.md",
      content: "same\n",
    });
    const r = await materializeEntry(origin, {
      kind: "memory",
      originRelPath: "projects/foo/memory/n.md",
      content: "same\n",
    });
    expect(r.status).toBe("unchanged");
  });

  it("failIfChanged conflicts on different content", async () => {
    await materializeEntry(origin, {
      kind: "skill",
      originRelPath: "skills/s/SKILL.md",
      content: "old\n",
    });
    const r = await materializeEntry(origin, {
      kind: "skill",
      originRelPath: "skills/s/SKILL.md",
      content: "new\n",
      failIfChanged: true,
    });
    expect(r.status).toBe("conflict");
  });

  it("rejects path traversal", async () => {
    await expect(
      materializeEntry(origin, {
        kind: "rule",
        originRelPath: "../escape.md",
        content: "x\n",
      }),
    ).rejects.toThrow(/escapes/);
  });
});

describe("commitOriginPaths", () => {
  let origin: string;

  beforeEach(async () => {
    origin = join(tmpdir(), `memex-commit-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(origin, { recursive: true });
    await git(["init"], origin);
    await git(["config", "user.email", "test@example.com"], origin);
    await git(["config", "user.name", "Test"], origin);
  });

  afterEach(async () => {
    await rm(origin, { recursive: true, force: true });
  });

  it("commits materialized paths", async () => {
    await materializeEntry(origin, {
      kind: "rule",
      originRelPath: "rules/c.md",
      content: "commit me\n",
    });
    const r = await commitOriginPaths(origin, ["rules/c.md"], "test: add rule");
    expect(r).toBe("committed");
    const r2 = await commitOriginPaths(origin, ["rules/c.md"], "test: noop");
    expect(r2).toBe("no-changes");
  });

  it("returns not-a-repo when plain directory", async () => {
    const plain = join(tmpdir(), `memex-plain-${Date.now()}`);
    await mkdir(plain);
    try {
      expect(await commitOriginPaths(plain, ["rules/a.md"], "x")).toBe("not-a-repo");
    } finally {
      await rm(plain, { recursive: true, force: true });
    }
  });
});

describe("migrateOriginToDefault + legacy compat symlink", () => {
  let home: string;

  beforeEach(async () => {
    home = join(tmpdir(), `memex-mig-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await mkdir(home, { recursive: true });
  });

  afterEach(async () => {
    await rm(home, { recursive: true, force: true });
  });

  it("renames legacy corpus to ~/.memex and installs compat symlink", async () => {
    const legacy = join(home, ".local", "share", "memex-claude");
    await mkdir(join(legacy, "rules"), { recursive: true });
    await writeFile(join(legacy, "rules", "r.md"), "rule\n", "utf-8");

    const result = await migrateOriginToDefault({
      homeDir: home,
      installCompatSymlink: true,
    });
    expect(result.status).toBe("migrated");
    if (result.status !== "migrated") return;

    const dest = defaultOriginRoot(home);
    expect(result.to).toBe(dest);
    expect(await readFile(join(dest, "rules", "r.md"), "utf-8")).toBe("rule\n");

    const st = await lstat(legacy);
    expect(st.isSymbolicLink()).toBe(true);
    expect(await realpath(legacy)).toBe(await realpath(dest));
    expect(result.compat).toBe("created");
  });

  it("installLegacyOriginCompatSymlink is fail-closed on real dir", async () => {
    const dest = defaultOriginRoot(home);
    await mkdir(dest, { recursive: true });
    const legacy = join(home, ".local", "share", "memex-claude");
    await mkdir(legacy, { recursive: true });
    await writeFile(join(legacy, "keep.md"), "x\n", "utf-8");

    const r = await installLegacyOriginCompatSymlink(dest, {
      legacyPath: legacy,
      homeDir: home,
    });
    expect(r).toBe("conflict");
    expect(await readFile(join(legacy, "keep.md"), "utf-8")).toBe("x\n");
  });
});

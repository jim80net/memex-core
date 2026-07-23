import { mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { type ConsistencyManifest, runConsistencyAudit } from "../src/consistency.ts";

const roots: string[] = [];

async function fixture(): Promise<{ root: string; manifest: ConsistencyManifest }> {
  const root = join(tmpdir(), `memex-consistency-${crypto.randomUUID()}`);
  roots.push(root);
  const adapter = join(root, "adapter");
  const installed = join(adapter, "node_modules", "@jim80net", "memex-core");
  await mkdir(installed, { recursive: true });
  await writeFile(
    join(adapter, "package.json"),
    JSON.stringify({ dependencies: { "@jim80net/memex-core": "^0.6.0" } }),
  );
  await writeFile(
    join(adapter, "pnpm-lock.yaml"),
    "dependencies:\n  '@jim80net/memex-core':\n    specifier: ^0.6.0\n    version: 0.6.1\n",
  );
  await writeFile(join(installed, "package.json"), JSON.stringify({ version: "0.6.1" }));
  await mkdir(join(root, "portable"), { recursive: true });
  await writeFile(join(root, "portable", "SKILL.md"), "portable");
  await mkdir(join(root, "origin"), { recursive: true });
  await mkdir(join(root, "projected"), { recursive: true });
  await writeFile(join(root, "origin", "active.md"), "---\nstatus: active\n---\n");
  await writeFile(join(root, "origin", "retired.md"), "---\nstatus: retired\n---\n");
  await mkdir(join(root, "origin", "active-skill"));
  await writeFile(
    join(root, "origin", "active-skill", "SKILL.md"),
    "---\nname: active-skill\n---\n",
  );
  await symlink(join(root, "origin", "active.md"), join(root, "projected", "active.md"));
  await symlink(join(root, "origin", "active-skill"), join(root, "projected", "active-skill"));
  await writeFile(join(root, "format-a.md"), "same\n");
  await writeFile(join(root, "format-b.md"), "same\n");
  return {
    root,
    manifest: {
      version: 1,
      expectedCoreVersion: "0.6.1",
      adapters: [{ name: "fixture", root: "adapter" }],
      portableLocations: [
        {
          name: "skill",
          roots: [{ key: "fixture", rootPath: "portable" }],
          absolute: "portable/SKILL.md",
          handle: "memex://fixture/SKILL.md",
        },
      ],
      projections: [
        { name: "active", source: "origin/active.md", target: "projected/active.md" },
        {
          name: "active-skill",
          source: "origin/active-skill",
          target: "projected/active-skill",
        },
        { name: "retired", source: "origin/retired.md", target: "projected/retired.md" },
      ],
      sharedFormats: [{ name: "memory", files: ["format-a.md", "format-b.md"] }],
    },
  };
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("runConsistencyAudit", () => {
  it("reports complete passing evidence", async () => {
    const { root, manifest } = await fixture();
    const report = await runConsistencyAudit(manifest, join(root, "manifest.json"));
    expect(report.ok).toBe(true);
    expect(report.checks).toHaveLength(6);
  });

  it("fails closed on missing evidence and drift", async () => {
    const { root, manifest } = await fixture();
    manifest.adapters[0].root = "missing";
    manifest.portableLocations[0].handle = "memex://fixture/wrong.md";
    manifest.projections[0].source = "origin/missing.md";
    manifest.sharedFormats[0].files[1] = "missing.md";
    const report = await runConsistencyAudit(manifest, join(root, "manifest.json"));
    expect(report.ok).toBe(false);
    expect(report.checks.filter((check) => !check.ok)).toHaveLength(4);
  });
});

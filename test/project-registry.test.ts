import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadRegistry,
  saveRegistry,
  registerProject,
  getKnownProjects,
} from "../src/project-registry.ts";
import type { ProjectRegistry } from "../src/types.ts";

describe("project registry", () => {
  let tmpDir: string;
  let registryPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `registry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    registryPath = join(tmpDir, "projects.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty registry when no file exists", async () => {
    const reg = await loadRegistry(registryPath);
    expect(reg.version).toBe(1);
    expect(reg.projects).toEqual({});
  });

  it("saves and loads registry", async () => {
    const reg = await loadRegistry(registryPath);
    registerProject(reg, "/home/user/project-a");
    await saveRegistry(registryPath, reg);

    const loaded = await loadRegistry(registryPath);
    expect(loaded.projects["/home/user/project-a"]).toBeDefined();
    expect(loaded.projects["/home/user/project-a"].lastSeen).toBeTruthy();
  });

  it("updates lastSeen on re-registration", async () => {
    const reg = await loadRegistry(registryPath);
    registerProject(reg, "/home/user/project-a");
    const first = reg.projects["/home/user/project-a"].lastSeen;

    registerProject(reg, "/home/user/project-a");
    expect(reg.projects["/home/user/project-a"].lastSeen >= first).toBe(true);
  });

  it("getKnownProjects returns paths sorted by most recent", () => {
    const reg: ProjectRegistry = {
      version: 1,
      projects: {
        "/old": { lastSeen: "2025-01-01T00:00:00Z" },
        "/new": { lastSeen: "2025-06-01T00:00:00Z" },
        "/mid": { lastSeen: "2025-03-01T00:00:00Z" },
      },
    };

    const paths = getKnownProjects(reg);
    expect(paths).toEqual(["/new", "/mid", "/old"]);
  });

  it("getKnownProjects returns empty array for empty registry", () => {
    const reg: ProjectRegistry = { version: 1, projects: {} };
    expect(getKnownProjects(reg)).toEqual([]);
  });
});

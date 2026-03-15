import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadTelemetry,
  saveTelemetry,
  recordMatch,
  getEntryTelemetry,
} from "../src/telemetry.ts";
import type { TelemetryData } from "../src/types.ts";

describe("telemetry", () => {
  let tmpDir: string;
  let telemetryPath: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `telemetry-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    await mkdir(tmpDir, { recursive: true });
    telemetryPath = join(tmpDir, "telemetry.json");
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty telemetry when no file exists", async () => {
    const data = await loadTelemetry(telemetryPath);
    expect(data.version).toBe(1);
    expect(data.entries).toEqual({});
  });

  it("saves and loads telemetry", async () => {
    const data = await loadTelemetry(telemetryPath);
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    await saveTelemetry(telemetryPath, data);

    const loaded = await loadTelemetry(telemetryPath);
    expect(loaded.entries["/skills/foo/SKILL.md"]).toBeDefined();
    expect(loaded.entries["/skills/foo/SKILL.md"].matchCount).toBe(1);
  });

  it("increments match count on repeated matches", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    recordMatch(data, "/skills/foo/SKILL.md", "session-2");

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.matchCount).toBe(3);
  });

  it("tracks unique session IDs", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    recordMatch(data, "/skills/foo/SKILL.md", "session-2");

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.sessionIds).toEqual(["session-1", "session-2"]);
  });

  it("caps session IDs at 50", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    for (let i = 0; i < 60; i++) {
      recordMatch(data, "/skills/foo/SKILL.md", `session-${i}`);
    }

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.sessionIds.length).toBe(50);
    expect(entry.sessionIds[0]).toBe("session-10");
    expect(entry.sessionIds[49]).toBe("session-59");
  });

  it("sets firstMatched on first match and preserves it", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    const first = data.entries["/skills/foo/SKILL.md"].firstMatched;

    recordMatch(data, "/skills/foo/SKILL.md", "session-2");
    expect(data.entries["/skills/foo/SKILL.md"].firstMatched).toBe(first);
  });

  it("updates lastMatched on every match", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    const first = data.entries["/skills/foo/SKILL.md"].lastMatched;

    recordMatch(data, "/skills/foo/SKILL.md", "session-2");
    expect(data.entries["/skills/foo/SKILL.md"].lastMatched >= first).toBe(true);
  });

  it("getEntryTelemetry returns undefined for unknown entries", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    expect(getEntryTelemetry(data, "/nonexistent")).toBeUndefined();
  });

  it("getEntryTelemetry returns entry data", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    const entry = getEntryTelemetry(data, "/skills/foo/SKILL.md");
    expect(entry).toBeDefined();
    expect(entry!.matchCount).toBe(1);
  });
});

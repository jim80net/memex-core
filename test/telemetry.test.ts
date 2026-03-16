import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearObservations,
  formatTelemetryReport,
  getEntryTelemetry,
  loadTelemetry,
  recordMatch,
  recordObservation,
  saveTelemetry,
} from "../src/telemetry.ts";
import type { Observation, TelemetryData } from "../src/types.ts";

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

  it("recordMatch tracks queryHits when queryIndex is provided", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1", 0);
    recordMatch(data, "/skills/foo/SKILL.md", "session-1", 0);
    recordMatch(data, "/skills/foo/SKILL.md", "session-1", 2);

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.queryHits).toEqual({ "0": 2, "2": 1 });
  });

  it("recordMatch creates queryHits on first match with queryIndex", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1", 1);

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.queryHits).toEqual({ "1": 1 });
  });

  it("recordMatch without queryIndex does not create queryHits", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.queryHits).toBeUndefined();
  });

  it("recordObservation appends observations", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");

    const obs: Observation = {
      sessionId: "session-1",
      prompt: "test prompt",
      score: 0.8,
      queryIndex: 0,
      outcome: "used",
      diagnosis: "matched well",
      timestamp: new Date().toISOString(),
    };
    recordObservation(data, "/skills/foo/SKILL.md", obs);

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.observations).toHaveLength(1);
    expect(entry.observations![0].outcome).toBe("used");
  });

  it("recordObservation caps at 100", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");

    for (let i = 0; i < 110; i++) {
      recordObservation(data, "/skills/foo/SKILL.md", {
        sessionId: `s-${i}`,
        prompt: `prompt-${i}`,
        score: 0.5,
        queryIndex: 0,
        outcome: "used",
        diagnosis: `diag-${i}`,
        timestamp: new Date().toISOString(),
      });
    }

    const entry = data.entries["/skills/foo/SKILL.md"];
    expect(entry.observations).toHaveLength(100);
    expect(entry.observations![0].sessionId).toBe("s-10");
    expect(entry.observations![99].sessionId).toBe("s-109");
  });

  it("recordObservation is a no-op for unknown entries", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    const obs: Observation = {
      sessionId: "s-1",
      prompt: "test",
      score: 0,
      queryIndex: -1,
      outcome: "missed",
      diagnosis: "no entry",
      timestamp: new Date().toISOString(),
    };
    recordObservation(data, "/nonexistent", obs);
    expect(data.entries["/nonexistent"]).toBeUndefined();
  });

  it("clearObservations deletes observations from entry", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1");
    recordObservation(data, "/skills/foo/SKILL.md", {
      sessionId: "s-1",
      prompt: "test",
      score: 0.8,
      queryIndex: 0,
      outcome: "used",
      diagnosis: "ok",
      timestamp: new Date().toISOString(),
    });
    expect(data.entries["/skills/foo/SKILL.md"].observations).toHaveLength(1);

    clearObservations(data, "/skills/foo/SKILL.md");
    expect(data.entries["/skills/foo/SKILL.md"].observations).toBeUndefined();
  });

  it("clearObservations is a no-op for unknown entries", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    clearObservations(data, "/nonexistent");
    expect(data.entries["/nonexistent"]).toBeUndefined();
  });

  it("formatTelemetryReport returns formatted table", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    recordMatch(data, "/skills/foo/SKILL.md", "session-1", 0);
    recordMatch(data, "/skills/bar/SKILL.md", "session-2");

    const report = formatTelemetryReport(data);
    expect(report).toContain("Entry | Matches | Sessions | Last Match | Obs | Query Hits");
    expect(report).toContain("/skills/foo/SKILL.md");
    expect(report).toContain("/skills/bar/SKILL.md");
    expect(report).toContain("q0:1");
  });

  it("formatTelemetryReport handles empty telemetry", () => {
    const data = { version: 1, entries: {} } as TelemetryData;
    expect(formatTelemetryReport(data)).toBe("No telemetry data.");
  });
});

import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EntryTelemetry, Observation, TelemetryData } from "./types.js";

const MAX_SESSION_IDS = 50;
const MAX_OBSERVATIONS = 100;

export async function loadTelemetry(telemetryPath: string): Promise<TelemetryData> {
  const empty: TelemetryData = { version: 1, entries: {} };
  try {
    const raw = await readFile(telemetryPath, "utf-8");
    const data = JSON.parse(raw) as TelemetryData;
    if (data.version !== 1) return empty;
    return data;
  } catch {
    return empty;
  }
}

export async function saveTelemetry(telemetryPath: string, data: TelemetryData): Promise<void> {
  const dir = dirname(telemetryPath);
  await mkdir(dir, { recursive: true });
  const tmpPath = `${telemetryPath}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data, null, 2), "utf-8");
  await rename(tmpPath, telemetryPath);
}

/**
 * Record that a skill was matched and injected. Mutates in place.
 * When queryIndex is provided, also increments queryHits for that index.
 */
export function recordMatch(
  telemetry: TelemetryData,
  location: string,
  sessionId: string,
  queryIndex?: number,
): void {
  const now = new Date().toISOString();
  const existing = telemetry.entries[location];

  if (existing) {
    existing.matchCount++;
    existing.lastMatched = now;
    if (!existing.sessionIds.includes(sessionId)) {
      existing.sessionIds.push(sessionId);
      if (existing.sessionIds.length > MAX_SESSION_IDS) {
        existing.sessionIds = existing.sessionIds.slice(-MAX_SESSION_IDS);
      }
    }
    if (queryIndex !== undefined) {
      existing.queryHits = existing.queryHits ?? {};
      const key = String(queryIndex);
      existing.queryHits[key] = (existing.queryHits[key] ?? 0) + 1;
    }
  } else {
    const entry: EntryTelemetry = {
      matchCount: 1,
      lastMatched: now,
      firstMatched: now,
      sessionIds: [sessionId],
    };
    if (queryIndex !== undefined) {
      entry.queryHits = { [String(queryIndex)]: 1 };
    }
    telemetry.entries[location] = entry;
  }
}

/**
 * Append an observation to an entry's observations array. Caps at MAX_OBSERVATIONS.
 */
export function recordObservation(
  telemetry: TelemetryData,
  location: string,
  observation: Observation,
): void {
  const entry = telemetry.entries[location];
  if (!entry) return;

  entry.observations = entry.observations ?? [];
  entry.observations.push(observation);
  if (entry.observations.length > MAX_OBSERVATIONS) {
    entry.observations = entry.observations.slice(-MAX_OBSERVATIONS);
  }
}

/**
 * Clear all observations from an entry.
 */
export function clearObservations(telemetry: TelemetryData, location: string): void {
  const entry = telemetry.entries[location];
  if (!entry) return;
  delete entry.observations;
}

/**
 * Format a telemetry report as a human-readable table string.
 */
export function formatTelemetryReport(telemetry: TelemetryData): string {
  const entries = Object.entries(telemetry.entries);
  if (entries.length === 0) return "No telemetry data.";

  const lines: string[] = [];
  lines.push("Entry | Matches | Sessions | Last Match | Obs | Query Hits");
  lines.push("--- | --- | --- | --- | --- | ---");

  for (const [location, entry] of entries) {
    const obsCount = entry.observations?.length ?? 0;
    const queryHits = entry.queryHits
      ? Object.entries(entry.queryHits)
          .map(([idx, count]) => `q${idx}:${count}`)
          .join(", ")
      : "-";
    lines.push(
      `${location} | ${entry.matchCount} | ${entry.sessionIds.length} | ${entry.lastMatched} | ${obsCount} | ${queryHits}`,
    );
  }

  return lines.join("\n");
}

/**
 * Get telemetry for a specific entry. Returns undefined if no data exists.
 */
export function getEntryTelemetry(
  telemetry: TelemetryData,
  location: string,
): EntryTelemetry | undefined {
  return telemetry.entries[location];
}

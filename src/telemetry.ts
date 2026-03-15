import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { EntryTelemetry, TelemetryData } from "./types.js";

const MAX_SESSION_IDS = 50;

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
 */
export function recordMatch(telemetry: TelemetryData, location: string, sessionId: string): void {
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
  } else {
    telemetry.entries[location] = {
      matchCount: 1,
      lastMatched: now,
      firstMatched: now,
      sessionIds: [sessionId],
    };
  }
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

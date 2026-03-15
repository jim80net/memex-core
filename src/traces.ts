import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ExecutionTrace } from "./types.js";

/**
 * Write an execution trace to disk.
 */
export async function writeTrace(tracesDir: string, trace: ExecutionTrace): Promise<void> {
  await mkdir(tracesDir, { recursive: true });
  const date = new Date().toISOString().slice(0, 10);
  const sessionSlug = trace.sessionKey.replace(/[^a-zA-Z0-9]/g, "-").slice(0, 60);
  const filename = `${date}-${sessionSlug}.json`;
  const filepath = join(tracesDir, filename);
  await writeFile(filepath, JSON.stringify(trace, null, 2), "utf-8");
}

/**
 * Accumulator for building traces across a session's lifecycle.
 * One per session, created on first hook fire, finalized on agent_end.
 */
export class TraceAccumulator {
  private traces: Map<
    string,
    {
      startTime: number;
      skillsInjected: Set<string>;
      toolsCalled: Set<string>;
      agentId: string;
      messageCount: number;
    }
  > = new Map();

  constructor(private tracesDir: string) {}

  recordInjection(sessionKey: string, agentId: string, skillNames: string[]): void {
    let entry = this.traces.get(sessionKey);
    if (!entry) {
      entry = {
        startTime: Date.now(),
        skillsInjected: new Set(),
        toolsCalled: new Set(),
        agentId,
        messageCount: 0,
      };
      this.traces.set(sessionKey, entry);
    }
    for (const name of skillNames) {
      entry.skillsInjected.add(name);
    }
  }

  recordToolCall(sessionKey: string, toolName: string): void {
    const entry = this.traces.get(sessionKey);
    if (entry) {
      entry.toolsCalled.add(toolName);
    }
  }

  recordMessageCount(sessionKey: string, count: number): void {
    const entry = this.traces.get(sessionKey);
    if (entry) {
      entry.messageCount = count;
    }
  }

  async finalize(
    sessionKey: string,
    outcome: ExecutionTrace["outcome"],
    errorSummary?: string,
  ): Promise<ExecutionTrace | null> {
    const entry = this.traces.get(sessionKey);
    if (!entry) return null;

    const trace: ExecutionTrace = {
      sessionKey,
      agentId: entry.agentId,
      timestamp: new Date().toISOString(),
      skillsInjected: [...entry.skillsInjected],
      toolsCalled: [...entry.toolsCalled],
      messageCount: entry.messageCount,
      durationMs: Date.now() - entry.startTime,
      outcome,
      errorSummary,
    };

    this.traces.delete(sessionKey);

    if (trace.messageCount > 2 || trace.toolsCalled.length > 0) {
      await writeTrace(this.tracesDir, trace);
    }

    return trace;
  }

  cleanup(maxAgeMs: number = 3600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, entry] of this.traces) {
      if (entry.startTime < cutoff) {
        this.traces.delete(key);
      }
    }
  }
}

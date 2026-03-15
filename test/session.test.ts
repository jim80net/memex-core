import { describe, it, expect } from "vitest";
import { InMemorySessionTracker } from "../src/session.ts";

describe("InMemorySessionTracker", () => {
  it("returns false for unseen rules", () => {
    const tracker = new InMemorySessionTracker();
    expect(tracker.hasRuleBeenShown("session-1", "/rules/foo.md")).toBe(false);
  });

  it("returns true after marking a rule shown", () => {
    const tracker = new InMemorySessionTracker();
    tracker.markRuleShown("session-1", "/rules/foo.md");
    expect(tracker.hasRuleBeenShown("session-1", "/rules/foo.md")).toBe(true);
  });

  it("tracks rules per session independently", () => {
    const tracker = new InMemorySessionTracker();
    tracker.markRuleShown("session-1", "/rules/foo.md");
    expect(tracker.hasRuleBeenShown("session-2", "/rules/foo.md")).toBe(false);
  });

  it("clearSession removes session data", () => {
    const tracker = new InMemorySessionTracker();
    tracker.markRuleShown("session-1", "/rules/foo.md");
    tracker.clearSession("session-1");
    expect(tracker.hasRuleBeenShown("session-1", "/rules/foo.md")).toBe(false);
  });

  it("cleanup removes stale sessions", async () => {
    const tracker = new InMemorySessionTracker();
    tracker.markRuleShown("session-1", "/rules/foo.md");

    // Wait a tick so lastAccess is in the past
    await new Promise((resolve) => setTimeout(resolve, 5));
    tracker.cleanup(1); // 1ms max age — the 5ms-old entry should be removed
    // Use clearSession to verify — hasRuleBeenShown would update lastAccess
    // Instead, mark again and check it was truly cleared
    expect(tracker.hasRuleBeenShown("session-1", "/rules/foo.md")).toBe(false);
  });

  it("cleanup preserves recent sessions", () => {
    const tracker = new InMemorySessionTracker();
    tracker.markRuleShown("session-1", "/rules/foo.md");

    // Cleanup with 1 hour max age should keep it
    tracker.cleanup(3600_000);
    expect(tracker.hasRuleBeenShown("session-1", "/rules/foo.md")).toBe(true);
  });
});

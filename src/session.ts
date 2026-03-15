// ---------------------------------------------------------------------------
// Session tracking for graduated disclosure
// ---------------------------------------------------------------------------

/**
 * Interface for tracking which rules have been shown per session.
 * Implementations may use in-memory or file-based persistence.
 */
export interface SessionTracker {
  hasRuleBeenShown(sessionId: string, location: string): boolean;
  markRuleShown(sessionId: string, location: string): void;
  clearSession(sessionId: string): void;
  cleanup(maxAgeMs?: number): void;
}

/**
 * In-memory session tracker. State resets on process restart.
 */
export class InMemorySessionTracker implements SessionTracker {
  private shownRules: Map<string, { rules: Set<string>; lastAccess: number }> = new Map();

  hasRuleBeenShown(sessionId: string, location: string): boolean {
    const entry = this.shownRules.get(sessionId);
    if (entry) entry.lastAccess = Date.now();
    return entry?.rules.has(location) ?? false;
  }

  markRuleShown(sessionId: string, location: string): void {
    let entry = this.shownRules.get(sessionId);
    if (!entry) {
      entry = { rules: new Set(), lastAccess: Date.now() };
      this.shownRules.set(sessionId, entry);
    }
    entry.lastAccess = Date.now();
    entry.rules.add(location);
  }

  clearSession(sessionId: string): void {
    this.shownRules.delete(sessionId);
  }

  cleanup(maxAgeMs: number = 3600_000): void {
    const cutoff = Date.now() - maxAgeMs;
    for (const [key, entry] of this.shownRules) {
      if (entry.lastAccess < cutoff) {
        this.shownRules.delete(key);
      }
    }
  }
}

import { describe, it, expect } from "vitest";
import { autoResolveMarkdownConflict } from "../src/sync.ts";

describe("markdown conflict resolution", () => {
  it("resolves a simple conflict by keeping both sides", () => {
    const conflicted = [
      "# Header",
      "<<<<<<< HEAD",
      "Local change",
      "=======",
      "Remote change",
      ">>>>>>> origin/main",
      "# Footer",
    ].join("\n");

    const resolved = autoResolveMarkdownConflict(conflicted);
    expect(resolved).toBe("# Header\nLocal change\n\nRemote change\n# Footer");
  });

  it("deduplicates identical conflict sides", () => {
    const conflicted = [
      "<<<<<<< HEAD",
      "Same content",
      "=======",
      "Same content",
      ">>>>>>> origin/main",
    ].join("\n");

    const resolved = autoResolveMarkdownConflict(conflicted);
    expect(resolved).toBe("Same content");
  });

  it("handles multiple conflicts in one file", () => {
    const conflicted = [
      "# Top",
      "<<<<<<< HEAD",
      "First local",
      "=======",
      "First remote",
      ">>>>>>> origin/main",
      "# Middle",
      "<<<<<<< HEAD",
      "Second local",
      "=======",
      "Second remote",
      ">>>>>>> origin/main",
      "# Bottom",
    ].join("\n");

    const resolved = autoResolveMarkdownConflict(conflicted);
    expect(resolved).toContain("First local");
    expect(resolved).toContain("First remote");
    expect(resolved).toContain("Second local");
    expect(resolved).toContain("Second remote");
    expect(resolved).toContain("# Middle");
    expect(resolved).toContain("# Bottom");
  });

  it("returns content unchanged when no conflicts", () => {
    const clean = "# No conflicts here\n\nJust regular content.";
    const resolved = autoResolveMarkdownConflict(clean);
    expect(resolved).toBe(clean);
  });
});

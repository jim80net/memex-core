import { describe, expect, it } from "vitest";
import { parseEntryLifecycle, resolveEntryLifecycle } from "../src/lifecycle.ts";

describe("entry lifecycle contract", () => {
  it("honors explicit active and retired status", () => {
    expect(parseEntryLifecycle("---\nstatus: retired\ndescription: old\n---\nbody")).toBe(
      "retired",
    );
    expect(parseEntryLifecycle("---\nstatus: active\ndescription: current\n---\nbody")).toBe(
      "active",
    );
  });

  it("bridges legacy RETIRED descriptions until corpus migration", () => {
    const markdown = '---\ndescription: "RETIRED 2026-06-11 — historical policy"\n---\nbody';
    expect(parseEntryLifecycle(markdown)).toBe("retired");
    expect(resolveEntryLifecycle(undefined, "RETIRED 2026-06-11 — historical policy")).toBe(
      "retired",
    );
  });

  it.each([
    ">-",
    ">",
    "|-",
    "|",
  ])("bridges legacy RETIRED descriptions encoded with %s", (indicator) => {
    const markdown = `---\ndescription: ${indicator}\n  RETIRED 2026-06-11 — historical policy\n---\nbody`;
    expect(parseEntryLifecycle(markdown)).toBe("retired");
  });

  it("defaults unknown or absent lifecycle to active", () => {
    expect(parseEntryLifecycle("# no frontmatter")).toBe("active");
    expect(resolveEntryLifecycle("draft", "ordinary description")).toBe("active");
  });
});

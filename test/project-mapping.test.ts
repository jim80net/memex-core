import { describe, it, expect } from "vitest";
import { normalizeGitUrl } from "../src/project-mapping.ts";

describe("normalizeGitUrl", () => {
  it("normalizes SSH git URLs", () => {
    expect(normalizeGitUrl("git@github.com:jim80net/claude-skill-router.git")).toBe(
      "github.com/jim80net/claude-skill-router",
    );
  });

  it("normalizes HTTPS git URLs", () => {
    expect(normalizeGitUrl("https://github.com/jim80net/claude-skill-router.git")).toBe(
      "github.com/jim80net/claude-skill-router",
    );
  });

  it("strips trailing .git suffix", () => {
    expect(normalizeGitUrl("git@gitlab.com:org/repo.git")).toBe("gitlab.com/org/repo");
  });

  it("handles URLs without .git suffix", () => {
    expect(normalizeGitUrl("https://github.com/jim80net/claude-skill-router")).toBe(
      "github.com/jim80net/claude-skill-router",
    );
  });

  it("handles SSH URLs with nested paths", () => {
    expect(normalizeGitUrl("git@github.com:org/sub/repo.git")).toBe(
      "github.com/org/sub/repo",
    );
  });

  it("trims whitespace", () => {
    expect(normalizeGitUrl("  git@github.com:org/repo.git  ")).toBe("github.com/org/repo");
  });

  it("handles non-standard SSH usernames", () => {
    expect(normalizeGitUrl("deploy@bitbucket.org:team/project.git")).toBe(
      "bitbucket.org/team/project",
    );
  });
});

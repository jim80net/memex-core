import { describe, expect, it } from "vitest";
import { normalizeGitUrl, resolveProjectId } from "../src/project-mapping.ts";

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
    expect(normalizeGitUrl("git@github.com:org/sub/repo.git")).toBe("github.com/org/sub/repo");
  });

  it("trims whitespace", () => {
    expect(normalizeGitUrl("  git@github.com:org/repo.git  ")).toBe("github.com/org/repo");
  });

  it("handles non-standard SSH usernames", () => {
    expect(normalizeGitUrl("deploy@bitbucket.org:team/project.git")).toBe(
      "bitbucket.org/team/project",
    );
  });

  it("lowercases the host and path by default", () => {
    expect(normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git")).toBe(
      "github.com/jim80net/repo",
    );
  });

  it("lowercases HTTPS URLs by default", () => {
    expect(normalizeGitUrl("https://GitHub.com/Jim80Net/Repo.git")).toBe(
      "github.com/jim80net/repo",
    );
  });

  it("preserves case when caseSensitive is true", () => {
    expect(normalizeGitUrl("git@GitHub.com:Jim80Net/Repo.git", true)).toBe(
      "GitHub.com/Jim80Net/Repo",
    );
  });
});

describe("resolveProjectId", () => {
  const baseConfig = {
    enabled: true,
    repo: "",
    autoPull: false,
    autoCommitPush: false,
    projectMappings: {} as Record<string, string>,
  };

  it("lowercases manual mapping values by default", async () => {
    const config = {
      ...baseConfig,
      projectMappings: { "/home/me/work": "MyOrg/MyProject" },
    };
    expect(await resolveProjectId("/home/me/work", config)).toBe("myorg/myproject");
  });

  it("preserves case in manual mappings when caseSensitive is true", async () => {
    const config = {
      ...baseConfig,
      projectMappings: { "/home/me/work": "MyOrg/MyProject" },
      caseSensitive: true,
    };
    expect(await resolveProjectId("/home/me/work", config)).toBe("MyOrg/MyProject");
  });

  it("lowercases _local encoded path fallback by default", async () => {
    // Use a guaranteed-nonexistent path so getGitRemoteUrl returns null
    // and we fall through to the encoded-path branch deterministically.
    const id = await resolveProjectId("/does-not-exist-memex-test/SomeDir", baseConfig);
    expect(id).toBe("_local/-does-not-exist-memex-test-somedir");
  });

  it("preserves encoded path case when caseSensitive is true", async () => {
    const id = await resolveProjectId("/does-not-exist-memex-test/SomeDir", {
      ...baseConfig,
      caseSensitive: true,
    });
    expect(id).toBe("_local/-does-not-exist-memex-test-SomeDir");
  });
});

import { describe, it, expect } from "vitest";
import { encodeProjectPath } from "../src/path-encoder.ts";

describe("encodeProjectPath", () => {
  it("encodes a typical home directory path", () => {
    expect(encodeProjectPath("/home/user/.myproject")).toBe("-home-user--myproject");
  });

  it("encodes a path with dots", () => {
    expect(encodeProjectPath("/home/user/my.project")).toBe("-home-user-my-project");
  });

  it("encodes root path", () => {
    expect(encodeProjectPath("/")).toBe("-");
  });

  it("encodes a deep path", () => {
    expect(encodeProjectPath("/home/user/projects/foo/bar")).toBe(
      "-home-user-projects-foo-bar",
    );
  });

  it("replaces underscores with hyphens", () => {
    expect(encodeProjectPath("/home/dev_user/my_project")).toBe(
      "-home-dev-user-my-project",
    );
  });

  it("encodes a path with underscores matching Claude Code behavior", () => {
    expect(encodeProjectPath("/home/jim/workspace/github.com/jim80net/a_book")).toBe(
      "-home-jim-workspace-github-com-jim80net-a-book",
    );
  });
});

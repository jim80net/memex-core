import { describe, expect, it } from "vitest";
import { encodeProjectPath } from "../src/path-encoder.ts";

describe("encodeProjectPath", () => {
  it("encodes a typical home directory path", () => {
    expect(encodeProjectPath("/srv/example-user/.myproject")).toBe("-srv-example-user--myproject");
  });

  it("encodes a path with dots", () => {
    expect(encodeProjectPath("/srv/example-user/my.project")).toBe("-srv-example-user-my-project");
  });

  it("encodes root path", () => {
    expect(encodeProjectPath("/")).toBe("-");
  });

  it("encodes a deep path", () => {
    expect(encodeProjectPath("/srv/example-user/projects/foo/bar")).toBe(
      "-srv-example-user-projects-foo-bar",
    );
  });

  it("replaces underscores with hyphens", () => {
    expect(encodeProjectPath("/srv/dev_user/my_project")).toBe("-srv-dev-user-my-project");
  });

  it("encodes a path with underscores matching Claude Code behavior", () => {
    expect(encodeProjectPath("/srv/example-user/workspace/github.com/jim80net/a_book")).toBe(
      "-srv-example-user-workspace-github-com-jim80net-a-book",
    );
  });
});

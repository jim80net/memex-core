import { describe, it, expect, afterEach } from "vitest";
import { mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { acquireLock, withFileLock } from "../src/file-lock.ts";

describe("file-lock", () => {
  const testDir = join(tmpdir(), `file-lock-test-${Date.now()}`);
  const testFile = join(testDir, "test.json");

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
  });

  it("acquires and releases a lock", async () => {
    await mkdir(testDir, { recursive: true });

    const unlock = await acquireLock(testFile);
    const lockDir = testFile + ".lock";
    const s = await stat(lockDir);
    expect(s.isDirectory()).toBe(true);

    await unlock();
    await expect(stat(lockDir)).rejects.toThrow();
  });

  it("withFileLock runs callback and releases lock", async () => {
    await mkdir(testDir, { recursive: true });

    let callbackRan = false;
    const result = await withFileLock(testFile, async () => {
      callbackRan = true;
      return 42;
    });

    expect(callbackRan).toBe(true);
    expect(result).toBe(42);

    const lockDir = testFile + ".lock";
    await expect(stat(lockDir)).rejects.toThrow();
  });

  it("releases lock even when callback throws", async () => {
    await mkdir(testDir, { recursive: true });

    await expect(
      withFileLock(testFile, async () => {
        throw new Error("callback error");
      }),
    ).rejects.toThrow("callback error");

    const lockDir = testFile + ".lock";
    await expect(stat(lockDir)).rejects.toThrow();
  });

  it("waits for an existing lock to be released", async () => {
    await mkdir(testDir, { recursive: true });

    const unlock1 = await acquireLock(testFile);
    setTimeout(async () => {
      await unlock1();
    }, 100);

    const unlock2 = await acquireLock(testFile);
    await unlock2();
  });
});

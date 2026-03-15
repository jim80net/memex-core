import { mkdir, rmdir, stat } from "node:fs/promises";

const LOCK_TIMEOUT_MS = 5_000;
const LOCK_RETRY_MS = 50;
const STALE_LOCK_MS = 30_000;

/**
 * Acquire an advisory file lock using mkdir (atomic on all platforms).
 * Returns an unlock function.
 */
export async function acquireLock(filePath: string): Promise<() => Promise<void>> {
  const lockDir = `${filePath}.lock`;
  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  while (Date.now() < deadline) {
    try {
      await mkdir(lockDir);
      return async () => {
        try {
          await rmdir(lockDir);
        } catch {
          // Lock already released or cleaned up
        }
      };
    } catch {
      // Lock exists — check if stale
      try {
        const lockStat = await stat(lockDir);
        if (Date.now() - lockStat.mtimeMs > STALE_LOCK_MS) {
          // Stale lock — force remove and retry
          try {
            await rmdir(lockDir);
          } catch {
            // Another process beat us to it
          }
          continue;
        }
      } catch {
        // Lock was released between our mkdir and stat — retry immediately
        continue;
      }

      // Wait before retrying
      await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
    }
  }

  // Timeout — proceed without lock (best-effort)
  return async () => {};
}

/**
 * Execute a callback while holding a file lock.
 * The lock is released after the callback completes (or throws).
 */
export async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const unlock = await acquireLock(filePath);
  try {
    return await fn();
  } finally {
    await unlock();
  }
}

import { normalizeFrontmatterScalar, unquoteFrontmatterScalar } from "./frontmatter.js";
import type { EntryLifecycle } from "./types.js";

const LEGACY_RETIRED_PREFIX = /^retired(?:\s|\b)/i;

/**
 * Resolve lifecycle with a compatibility bridge for existing corpus entries
 * whose retirement was encoded only in the description.
 */
export function resolveEntryLifecycle(
  lifecycle: unknown,
  description: string | undefined,
): EntryLifecycle {
  if (lifecycle === "retired") return "retired";
  if (lifecycle === "active") return "active";
  return description && LEGACY_RETIRED_PREFIX.test(description.trim()) ? "retired" : "active";
}

/** Read only the lifecycle-bearing scalar frontmatter fields from markdown. */
export function parseEntryLifecycle(content: string): EntryLifecycle {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) return "active";

  let lifecycle: string | undefined;
  let description: string | undefined;
  const lines = match[1].split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const scalar = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    if (!scalar) continue;
    if (scalar[1] === "status") {
      lifecycle = unquoteFrontmatterScalar(scalar[2]).trim().toLowerCase();
    }
    if (scalar[1] === "description") {
      const parsed = normalizeFrontmatterScalar(lines, lineIndex, scalar[2]);
      description = parsed.value;
      lineIndex = parsed.nextIndex - 1;
    }
  }
  return resolveEntryLifecycle(lifecycle, description);
}

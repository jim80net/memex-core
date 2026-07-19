import type { EntryLifecycle } from "./types.js";

const LEGACY_RETIRED_PREFIX = /^retired(?:\s|\b)/i;

function unquote(value: string): string {
  return value.replace(/^(["'])([\s\S]*)\1$/, "$2").trim();
}

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
  for (const line of match[1].split(/\r?\n/)) {
    const scalar = line.match(/^([A-Za-z][\w-]*):\s*(.*?)\s*$/);
    if (!scalar) continue;
    if (scalar[1] === "status") lifecycle = unquote(scalar[2]).toLowerCase();
    if (scalar[1] === "description") description = unquote(scalar[2]);
  }
  return resolveEntryLifecycle(lifecycle, description);
}

import type { MemexCoreConfig } from "./types.js";

export const DEFAULT_CORE_CONFIG: MemexCoreConfig = {
  enabled: true,
  embeddingModel: "Xenova/all-MiniLM-L6-v2",
  embeddingBackend: "local",
  cacheTimeMs: 300_000, // 5 min
  topK: 3,
  threshold: 0.35, // floor: best match must clear this to inject anything
  scoringMode: "relative",
  maxDropoff: 0.1, // in relative mode, drop results scoring > this below the best match
  maxInjectedChars: 8000,
  types: ["skill", "memory", "workflow", "session-learning", "rule"],
  skillDirs: [],
  memoryDirs: [],
};

/**
 * Resolve a core config from a partial runtime config dict.
 * Merges with defaults, validating types.
 */
export function resolveCoreConfig(partial?: Partial<MemexCoreConfig>): MemexCoreConfig {
  if (!partial) return { ...DEFAULT_CORE_CONFIG };
  return {
    enabled: typeof partial.enabled === "boolean" ? partial.enabled : DEFAULT_CORE_CONFIG.enabled,
    embeddingModel:
      typeof partial.embeddingModel === "string"
        ? partial.embeddingModel
        : DEFAULT_CORE_CONFIG.embeddingModel,
    embeddingBackend:
      partial.embeddingBackend === "openai" ? "openai" : DEFAULT_CORE_CONFIG.embeddingBackend,
    cacheTimeMs:
      typeof partial.cacheTimeMs === "number"
        ? partial.cacheTimeMs
        : DEFAULT_CORE_CONFIG.cacheTimeMs,
    topK: typeof partial.topK === "number" ? partial.topK : DEFAULT_CORE_CONFIG.topK,
    threshold:
      typeof partial.threshold === "number" ? partial.threshold : DEFAULT_CORE_CONFIG.threshold,
    scoringMode: partial.scoringMode === "absolute" ? "absolute" : DEFAULT_CORE_CONFIG.scoringMode,
    maxDropoff:
      typeof partial.maxDropoff === "number" ? partial.maxDropoff : DEFAULT_CORE_CONFIG.maxDropoff,
    maxInjectedChars:
      typeof partial.maxInjectedChars === "number"
        ? partial.maxInjectedChars
        : DEFAULT_CORE_CONFIG.maxInjectedChars,
    types: Array.isArray(partial.types) ? partial.types : DEFAULT_CORE_CONFIG.types,
    skillDirs: Array.isArray(partial.skillDirs)
      ? partial.skillDirs.map(String)
      : DEFAULT_CORE_CONFIG.skillDirs,
    memoryDirs: Array.isArray(partial.memoryDirs)
      ? partial.memoryDirs.map(String)
      : DEFAULT_CORE_CONFIG.memoryDirs,
  };
}

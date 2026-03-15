// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

export type Logger = {
  info: (msg: string) => void;
  warn: (msg: string) => void;
  error: (msg: string) => void;
  debug?: (msg: string) => void;
};

// ---------------------------------------------------------------------------
// Skill types
// ---------------------------------------------------------------------------

export type SkillType =
  | "skill"
  | "memory"
  | "tool-guidance"
  | "workflow"
  | "session-learning"
  | "stop-rule"
  | "rule";

export type IndexedSkill = {
  name: string;
  description: string;
  location: string;
  type: SkillType;
  embeddings: number[][];
  queries: string[];
  oneLiner?: string;
};

export type SkillSearchResult = {
  skill: IndexedSkill;
  score: number;
};

export type ParsedFrontmatter = {
  name?: string;
  description?: string;
  queries?: string[];
  type?: SkillType;
  paths?: string[];
  hooks?: string[];
  keywords?: string[];
  oneLiner?: string;
  [key: string]: unknown;
};

export type ParsedSkill = {
  meta: ParsedFrontmatter;
  body: string;
};

// ---------------------------------------------------------------------------
// Cache schema (version 2)
// ---------------------------------------------------------------------------

export type CachedSkill = {
  name: string;
  description: string;
  queries: string[];
  embeddings: number[][];
  mtime: number;
  type: SkillType;
  oneLiner?: string;
};

export type CacheData = {
  version: 2;
  embeddingModel: string;
  skills: Record<string, CachedSkill>;
};

// ---------------------------------------------------------------------------
// Session state
// ---------------------------------------------------------------------------

export type SessionState = {
  sessionId: string;
  shownRules: Record<string, number>; // rule location → timestamp of full injection
};

// ---------------------------------------------------------------------------
// Hook I/O
// ---------------------------------------------------------------------------

export type HookInput = {
  hook_event_name: string;
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  prompt?: string;
  tool_name?: string;
  tool_input?: Record<string, unknown>;
};

export type HookOutput = {
  additionalContext?: string;
};

// ---------------------------------------------------------------------------
// Telemetry
// ---------------------------------------------------------------------------

export type EntryTelemetry = {
  matchCount: number;
  lastMatched: string; // ISO timestamp
  firstMatched: string; // ISO timestamp
  sessionIds: string[]; // unique session IDs (capped)
};

export type TelemetryData = {
  version: 1;
  entries: Record<string, EntryTelemetry>; // keyed by skill location
};

// ---------------------------------------------------------------------------
// Execution traces
// ---------------------------------------------------------------------------

export type ExecutionTrace = {
  sessionKey: string;
  agentId: string;
  timestamp: string;
  skillsInjected: string[];
  toolsCalled: string[];
  messageCount: number;
  durationMs: number;
  outcome: "completed" | "error" | "timeout" | "unknown";
  errorSummary?: string;
};

// ---------------------------------------------------------------------------
// Scoring
// ---------------------------------------------------------------------------

export type ScoringMode = "relative" | "absolute";

// ---------------------------------------------------------------------------
// Configurable paths
// ---------------------------------------------------------------------------

export type MemexPaths = {
  cacheDir: string;
  modelsDir: string;
  sessionsDir: string;
  syncRepoDir: string;
  projectsDir: string;
  globalSkillsDir: string;
  globalRulesDir: string;
  telemetryPath: string;
  registryPath: string;
  tracesDir: string;
};

// ---------------------------------------------------------------------------
// Core config (base — consumers extend with platform-specific fields)
// ---------------------------------------------------------------------------

export type MemexCoreConfig = {
  enabled: boolean;
  embeddingModel: string;
  embeddingBackend: "openai" | "local";
  cacheTimeMs: number;
  topK: number;
  threshold: number;
  scoringMode: ScoringMode;
  maxDropoff: number;
  maxInjectedChars: number;
  types: SkillType[];
  skillDirs: string[];
  memoryDirs: string[];
};

// ---------------------------------------------------------------------------
// Sync config
// ---------------------------------------------------------------------------

export type SyncConfig = {
  enabled: boolean;
  repo: string;
  autoPull: boolean;
  autoCommitPush: boolean;
  projectMappings: Record<string, string>; // local path → canonical project id
};

// ---------------------------------------------------------------------------
// Project registry
// ---------------------------------------------------------------------------

export type ProjectRegistry = {
  version: 1;
  projects: Record<string, { lastSeen: string }>; // cwd → metadata
};

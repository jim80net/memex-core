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

/** Corpus lifecycle. Retired entries remain readable as history but are inactive by default. */
export type EntryLifecycle = "active" | "retired";

export type IndexedSkill = {
  name: string;
  description: string;
  /** Portable memex:// handle when a scan-root registry is configured; otherwise absolute path. */
  location: string;
  type: SkillType;
  embeddings: number[][];
  queries: string[];
  oneLiner?: string;
  boost?: number;
  /** Optional for source compatibility; indexed/cache entries always populate it. */
  lifecycle?: EntryLifecycle;
};

export type SkillSearchResult = {
  skill: IndexedSkill;
  score: number;
  bestQueryIndex: number;
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
  boost?: number;
  status?: EntryLifecycle;
  [key: string]: unknown;
};

export type ParsedSkill = {
  meta: ParsedFrontmatter;
  body: string;
};

// ---------------------------------------------------------------------------
// Cache schema (version 3 — portable location handles)
// ---------------------------------------------------------------------------

export type CachedSkill = {
  name: string;
  description: string;
  queries: string[];
  embeddings: number[][];
  mtime: number;
  type: SkillType;
  oneLiner?: string;
  boost?: number;
  lifecycle?: EntryLifecycle;
};

export type CacheData = {
  version: 3;
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

export type Observation = {
  sessionId: string;
  prompt: string;
  score: number;
  queryIndex: number;
  outcome: "used" | "ignored" | "corrected" | "missed";
  diagnosis: string;
  timestamp: string;
};

export type EntryTelemetry = {
  matchCount: number;
  lastMatched: string; // ISO timestamp
  firstMatched: string; // ISO timestamp
  sessionIds: string[]; // unique session IDs (capped)
  queryHits?: Record<string, number>; // queryIndex (string key) -> hit count
  observations?: Observation[]; // ASI from deep-sleep, capped at 100
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
  /**
   * When true, project IDs preserve the case of git remote URLs, manual mappings,
   * and encoded cwd paths. When false or undefined (default), project IDs are
   * lowercased across all three resolution paths.
   */
  caseSensitive?: boolean;
};

// ---------------------------------------------------------------------------
// Shared origin + sync profile (file-shaped projection)
// ---------------------------------------------------------------------------

/** Where origin content lives on this host. */
export type OriginConfig = {
  /** Absolute or `~/…` path. Empty → resolver default chain. */
  root?: string;
  /**
   * Optional git remote for the origin tree (same role as SyncConfig.repo).
   * Empty / omitted → host-local origin only.
   */
  repo?: string;
};

/**
 * One harness projection target. Core is harness-agnostic: it only sees
 * absolute directory paths + which origin subtrees to link.
 */
export type ProjectionTarget = {
  /** Stable id for logs/doctor: "grok-user-rules", "claude-user-rules", … */
  id: string;
  /** Absolute harness directory to ensure + project into. */
  targetDir: string;
  /**
   * Origin-relative source directory under origin.root
   * e.g. "rules", "skills", "projects/github.com/jim80net/foo/memory"
   */
  originRelDir: string;
  /**
   * "files" — each matching file becomes a symlink entry
   * "skill-dirs" — each child dir with SKILL.md is linked as a whole directory
   */
  entryKind: "files" | "skill-dirs";
  /** Glob/suffix filter; default "*.md" for files, ignored for skill-dirs. */
  pattern?: string;
  /** When true, create targetDir if missing. Default true. */
  initTargetDir?: boolean;
};

export type SyncProfile = {
  /** Schema version for migrations. */
  version: 1;
  /** Master switch for profile-driven origin + projection. */
  enabled: boolean;
  origin: OriginConfig;
  /**
   * Projection targets. Empty array = origin-only (materialize/sync git)
   * without symlink management.
   */
  projections: ProjectionTarget[];
  /**
   * Conflict policy when target has a non-link real file/dir.
   * v1: only "fail-closed" is supported.
   */
  onClobber: "fail-closed";
  /**
   * When true, replace a symlink that already points inside origin.root
   * if the origin entry moved (relink). Default true.
   */
  relinkManaged?: boolean;
  /**
   * Bridge to existing SyncConfig git pull/push behavior.
   * If omitted, profile can still project a local-only origin.
   */
  sync?: Pick<SyncConfig, "autoPull" | "autoCommitPush" | "projectMappings" | "caseSensitive">;
};

export type ProjectConflictReason =
  | "real-file"
  | "real-dir"
  | "foreign-symlink"
  | "broken-unmanaged"
  | "changed-managed-symlink"
  | "lifecycle-read-error"
  | "type-mismatch";

export type ProjectConflict = {
  targetPath: string;
  originPath: string;
  reason: ProjectConflictReason;
};

export type ProjectLinkAction = "create" | "relink" | "noop";

export type ProjectLinkPlan = {
  targetPath: string;
  originPath: string;
  action: ProjectLinkAction;
};

export type ProjectRemovalPlan = {
  /** Managed harness symlink to remove because its origin entry is retired. */
  targetPath: string;
  originPath: string;
};

export type ProjectPlan = {
  ensureDirs: string[];
  links: ProjectLinkPlan[];
  /** Optional for compatibility with adapters constructing empty plans. */
  removals?: ProjectRemovalPlan[];
  conflicts: ProjectConflict[];
};

export type MaterializeKind = "rule" | "skill" | "memory";

export type MaterializeInput = {
  kind: MaterializeKind;
  /** Origin-relative destination, e.g. "rules/my-rule.md" or "skills/foo/SKILL.md" */
  originRelPath: string;
  /** Full markdown body including frontmatter (caller-owned format for v1). */
  content: string;
  /** If true, refuse overwrite when destination exists and content differs. */
  failIfChanged?: boolean;
};

export type MaterializeResult =
  | { status: "created" | "updated" | "unchanged"; absPath: string }
  | { status: "conflict"; absPath: string; reason: string };

// ---------------------------------------------------------------------------
// Project registry
// ---------------------------------------------------------------------------

export type ProjectRegistry = {
  version: 1;
  projects: Record<string, { lastSeen: string }>; // cwd → metadata
};

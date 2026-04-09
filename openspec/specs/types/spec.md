## Requirements

### Requirement: Logger type for structured logging

The `Logger` type SHALL provide four methods: `info(msg)`, `warn(msg)`, `error(msg)`, and an optional `debug?(msg)`. Consumers supply their own implementation; the core never constructs a Logger.

#### Scenario: Logger with debug method

- **WHEN** a consumer provides a Logger with `info`, `warn`, `error`, and `debug`
- **THEN** TypeScript accepts the value and all four methods are callable

#### Scenario: Logger without debug method

- **WHEN** a consumer provides a Logger with only `info`, `warn`, and `error`
- **THEN** TypeScript accepts the value (debug is optional) and the three required methods are callable

### Requirement: SkillType discriminates entry kinds

`SkillType` SHALL be a union of string literals: `"skill"`, `"memory"`, `"tool-guidance"`, `"workflow"`, `"session-learning"`, `"stop-rule"`, and `"rule"`. Each indexed entry carries exactly one SkillType, which determines how consumers present and filter it.

#### Scenario: Valid SkillType values

- **WHEN** a value is assigned one of the seven literal strings
- **THEN** TypeScript accepts the assignment without widening to `string`

### Requirement: IndexedSkill captures an embedded entry

`IndexedSkill` SHALL contain `name`, `description`, `location` (file path, possibly with `#SectionName`), `type` (SkillType), `embeddings` (array of number arrays), `queries` (search trigger strings), and optional `oneLiner` and `boost`.

#### Scenario: IndexedSkill with memory section reference

- **WHEN** a memory file section named "Project Conventions" at path `/skills/team.md` is indexed
- **THEN** `location` is `"/skills/team.md#Project Conventions"` and `type` is `"memory"`

### Requirement: SkillSearchResult pairs a skill with match metadata

`SkillSearchResult` SHALL contain `skill` (IndexedSkill), `score` (number, cosine similarity plus boost), and `bestQueryIndex` (the index into `skill.queries` that had the highest similarity to the search query).

#### Scenario: Best query index identifies the matching trigger

- **WHEN** a skill has queries `["deploy steps", "release process"]` and the second query matches best
- **THEN** `bestQueryIndex` is `1`

### Requirement: ParsedFrontmatter is a partial record with list keys

`ParsedFrontmatter` SHALL allow `name`, `description`, `queries`, `type`, `paths`, `hooks`, `keywords`, `oneLiner`, and `boost` as known keys, plus an index signature `[key: string]: unknown` for extension. `queries`, `paths`, `hooks`, and `keywords` are string arrays; `boost` is a number.

#### Scenario: Unknown frontmatter key preserved

- **WHEN** a skill file contains `custom_field: value` in its frontmatter
- **THEN** `ParsedFrontmatter` carries `custom_field` via the index signature

### Requirement: CacheData uses version 2 schema

`CacheData` SHALL have `version: 2` (literal type), `embeddingModel: string`, and `skills: Record<string, CachedSkill>` keyed by file location.

#### Scenario: Version mismatch returns empty cache

- **WHEN** `loadCache` reads a file with `version: 1`
- **THEN** the function returns an empty `CacheData` with `version: 2`

### Requirement: CachedSkill stores serialized entry data

`CachedSkill` SHALL contain `name`, `description`, `queries`, `embeddings` (number arrays), `mtime` (number), `type` (SkillType), and optional `oneLiner` and `boost`.

#### Scenario: Round-trip conversion preserves all fields

- **WHEN** an `IndexedSkill` with location "/a.md" is converted via `toCachedSkill` then `fromCachedSkill`
- **THEN** all fields match except `location`, which is passed separately as the Record key

### Requirement: SessionState tracks per-session rule exposure

`SessionState` SHALL contain `sessionId: string` and `shownRules: Record<string, number>` mapping rule location to the timestamp when full content was last injected.

#### Scenario: Rule shown timestamp recorded

- **WHEN** a rule at location `/rules/deploy.md` is injected in session "abc"
- **THEN** `shownRules["/rules/deploy.md"]` is set to the injection timestamp

### Requirement: HookInput carries platform hook payload

`HookInput` SHALL contain `hook_event_name: string` and optional `session_id`, `transcript_path`, `cwd`, `prompt`, `tool_name`, and `tool_input` fields. `HookOutput` SHALL contain an optional `additionalContext` string.

#### Scenario: HookInput with tool context

- **WHEN** a PreToolUse hook fires with `tool_name: "Bash"` and `tool_input: { command: "rm -rf /" }`
- **THEN** `HookInput.tool_name` is `"Bash"` and `HookInput.tool_input` is `{ command: "rm -rf /" }`

### Requirement: Observation tracks match assessment outcomes

`Observation` SHALL contain `sessionId`, `prompt`, `score: number`, `queryIndex: number`, `outcome` (`"used" | "ignored" | "corrected" | "missed"`), `diagnosis: string`, and `timestamp: string` (ISO).

#### Scenario: Observation with "ignored" outcome

- **WHEN** a skill was matched but the agent did not follow it
- **THEN** `outcome` is `"ignored"` and `diagnosis` describes the context

### Requirement: EntryTelemetry aggregates per-entry match statistics

`EntryTelemetry` SHALL contain `matchCount`, `lastMatched`, `firstMatched` (ISO timestamps), `sessionIds` (string array capped at 50), optional `queryHits` (Record of query index to hit count), and optional `observations` (array capped at 100).

#### Scenario: Session ID cap

- **WHEN** `recordMatch` is called for the 51st unique session ID
- **THEN** `sessionIds` is trimmed to the 50 most recent entries

### Requirement: TelemetryData uses version 1 schema

`TelemetryData` SHALL have `version: 1` (literal type) and `entries: Record<string, EntryTelemetry>` keyed by skill location.

#### Scenario: Missing telemetry file returns empty data

- **WHEN** `loadTelemetry` reads a non-existent file
- **THEN** the returned `TelemetryData` has `version: 1` and `entries: {}`

### Requirement: ExecutionTrace records session lifecycle data

`ExecutionTrace` SHALL contain `sessionKey`, `agentId`, `timestamp` (ISO), `skillsInjected` (string array), `toolsCalled` (string array), `messageCount`, `durationMs`, `outcome` (`"completed" | "error" | "timeout" | "unknown"`), and optional `errorSummary`.

#### Scenario: Trace with error outcome

- **WHEN** an agent session ends with an error
- **THEN** `outcome` is `"error"` and `errorSummary` contains a short description

### Requirement: ScoringMode controls threshold behavior

`ScoringMode` SHALL be `"relative" | "absolute"`. In absolute mode each result must individually exceed the threshold. In relative mode, results within `maxDropoff` of the best are included if the best clears the threshold.

#### Scenario: Relative mode returns cluster

- **WHEN** `scoringMode` is `"relative"` with `threshold: 0.35` and `maxDropoff: 0.1`
- **THEN** a result scoring 0.72 is included if the best match scores 0.78

### Requirement: MemexPaths defines all filesystem paths

`MemexPaths` SHALL contain `cacheDir`, `modelsDir`, `sessionsDir`, `syncRepoDir`, `projectsDir`, `globalSkillsDir`, `globalRulesDir`, `telemetryPath`, `registryPath`, and `tracesDir` — all strings. Consumers construct this object and pass individual paths; the core never assumes path locations.

#### Scenario: All path fields required

- **WHEN** a consumer constructs a `MemexPaths` object
- **THEN** all ten path fields must be provided (no optional path fields)

### Requirement: MemexCoreConfig has sensible defaults

`MemexCoreConfig` SHALL require `enabled`, `embeddingModel`, `embeddingBackend` (`"openai" | "local"`), `cacheTimeMs`, `topK`, `threshold`, `scoringMode`, `maxDropoff`, `maxInjectedChars`, `types` (SkillType array), `skillDirs`, and `memoryDirs`. All have defaults provided by `DEFAULT_CORE_CONFIG`.

#### Scenario: Partial config merged with defaults

- **WHEN** `resolveCoreConfig({ topK: 5 })` is called
- **THEN** the result has `topK: 5` and all other fields from `DEFAULT_CORE_CONFIG`

### Requirement: SyncConfig controls cross-device synchronization

`SyncConfig` SHALL require `enabled`, `repo`, `autoPull`, `autoCommitPush`, and `projectMappings` (Record of string to string). It SHALL include an optional `caseSensitive?: boolean` field — when unset or `false`, project IDs are lowercased across all resolution paths.

#### Scenario: Default case handling

- **WHEN** `SyncConfig` is constructed without `caseSensitive`
- **THEN** project IDs are lowercased across manual mappings, git remotes, and encoded path fallbacks

### Requirement: ProjectRegistry tracks known directories

`ProjectRegistry` SHALL have `version: 1` (literal type) and `projects: Record<string, { lastSeen: string }>` mapping cwd paths to metadata.

#### Scenario: Empty registry on missing file

- **WHEN** `loadRegistry` reads a non-existent file
- **THEN** the returned `ProjectRegistry` has `version: 1` and `projects: {}`
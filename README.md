# @jim80net/memex-core

Shared core engine for semantic skill, memory, and rule routing in AI agent systems. Provides local embedding generation (via ONNX), a vector-similarity search index, file caching, session tracking, telemetry, cross-device sync, and execution traces -- all with no external API keys required. This package is consumed by platform-specific routers like [claude-skill-router](https://github.com/jim80net/claude-skill-router) (Claude Code hooks) and [openclaw-skill-router](https://github.com/jim80net/openclaw-skill-router) (OpenClaw plugin).

## Install

```bash
npm install @jim80net/memex-core
# or
pnpm add @jim80net/memex-core
```

For local embeddings (recommended), also install the optional ONNX dependency:

```bash
pnpm add @huggingface/transformers
```

## Quick Start

```typescript
import {
  LocalEmbeddingProvider,
  SkillIndex,
  resolveCoreConfig,
} from "@jim80net/memex-core";

// 1. Create an embedding provider
const provider = new LocalEmbeddingProvider("Xenova/all-MiniLM-L6-v2", "/tmp/models");

// 2. Resolve config (merges your overrides with defaults)
const config = resolveCoreConfig({ topK: 5, threshold: 0.35 });

// 3. Build the index
const index = new SkillIndex(config, provider, "/tmp/cache/memex-cache.json");
await index.build({
  skillDirs: ["./skills"],
  memoryDirs: ["./memory"],
  ruleDirs: ["./rules"],
});

// 4. Search
const results = await index.search("how do I deploy?", config.topK, config.threshold);
for (const { skill, score } of results) {
  console.log(`${skill.name} (${skill.type}): ${score.toFixed(3)}`);
  const content = await index.readSkillContent(skill.location);
  console.log(content);
}
```

## Architecture

| Module | Purpose |
|--------|---------|
| `embeddings` | `EmbeddingProvider` interface with two implementations: `LocalEmbeddingProvider` (ONNX via `@huggingface/transformers`) and `OpenAIEmbeddingProvider`. Also exports `cosineSimilarity()`. |
| `skill-index` | `SkillIndex` class -- the main engine. Scans directories for skills, rules, and memories; embeds their queries; caches embeddings; searches by cosine similarity. Also exports `parseFrontmatter()` and `parseMemoryFile()`. |
| `cache` | Persistent embedding cache (version 2). Loads/saves a JSON file keyed by file location and gated by mtime. |
| `config` | `DEFAULT_CORE_CONFIG` and `resolveCoreConfig()` for merging partial config with type-safe defaults. |
| `session` | `SessionTracker` interface and `InMemorySessionTracker` for tracking which rules have been shown per session (graduated disclosure). |
| `telemetry` | Match telemetry: records how often each skill/rule/memory is matched, across which sessions. |
| `sync` | Git-based cross-device sync: pull with auto-conflict resolution, commit and push local changes. |
| `traces` | `TraceAccumulator` for recording execution traces (skills injected, tools called, outcome) per session. |
| `file-lock` | Advisory file locking via `mkdir` (atomic on all platforms). `withFileLock()` for safe concurrent writes. |
| `path-encoder` | `encodeProjectPath()` -- encodes absolute paths into safe directory names. |
| `project-mapping` | Resolves a working directory to a canonical project ID (git remote URL, manual mapping, or encoded path fallback). |
| `project-registry` | Tracks known project directories with `lastSeen` timestamps. |
| `types` | All TypeScript types and interfaces. |
| `version` | `VERSION` constant, injected at compile time or defaulting to `"dev"`. |

## Key Concepts

### EmbeddingProvider

An interface with a single method:

```typescript
interface EmbeddingProvider {
  embed(texts: string[]): Promise<number[][]>;
}
```

Two built-in implementations:

- **`LocalEmbeddingProvider`** -- Runs ONNX models locally via `@huggingface/transformers`. No API key needed. Default model: `Xenova/all-MiniLM-L6-v2`. Lazily initializes the model on first call.
- **`OpenAIEmbeddingProvider`** -- Calls the OpenAI embeddings API. Requires an API key and model name. Batches in groups of 2048.

### SkillIndex

The central class. Constructed with `(config, provider, cachePath)`.

- **`build(scanDirs)`** -- Scans `skillDirs`, `memoryDirs`, and `ruleDirs` for markdown files. Parses frontmatter, generates embeddings for queries, and caches results. Skips unchanged files (mtime-gated). The consumer constructs the `ScanDirs` object -- no paths are hardcoded.
- **`search(query, topK, threshold, typeFilter?, scoringMode?, maxDropoff?)`** -- Embeds the query, computes cosine similarity against all indexed entries, and returns the top matches.
- **`readSkillContent(location)`** -- Reads the body content of a matched skill, stripping frontmatter. Handles memory sections (locations like `path#SectionName`).
- **`needsRebuild()`** -- Returns `true` if the cache TTL (`cacheTimeMs`) has expired.

### ScanDirs

```typescript
type ScanDirs = {
  skillDirs: string[];   // directories containing skill-name/SKILL.md subdirectories
  memoryDirs: string[];  // directories containing *.md memory files
  ruleDirs: string[];    // directories containing *.md rule files
};
```

The consumer builds this from platform-specific paths (e.g., `~/.claude/skills/`, `~/.openclaw/skills/`). This is how the core stays platform-agnostic.

### MemexPaths

```typescript
type MemexPaths = {
  cacheDir: string;
  modelsDir: string;
  sessionsDir: string;
  syncRepoDir: string;
  projectsDir: string;
  telemetryPath: string;
  registryPath: string;
  tracesDir: string;
};
```

A descriptor for all filesystem paths the engine uses. The consumer constructs this and passes individual paths to the relevant functions. The core never assumes path locations.

### Scoring Modes

- **`"relative"`** (default) -- If the best match clears the threshold floor, include up to `topK` results that are within `maxDropoff` of the best score. Good for surfacing a cluster of related content.
- **`"absolute"`** -- Each result must individually exceed the threshold. Stricter, but may return fewer results.

### Frontmatter Extensions

Skills and rules use YAML frontmatter with these fields:

```yaml
---
name: my-skill
description: What this skill does
type: skill          # skill | memory | rule | workflow | session-learning | tool-guidance | stop-rule
queries:
  - "how do I deploy"
  - "deployment steps"
keywords:
  - deploy
  - release
paths:
  - "src/**/*.ts"
hooks:
  - PreToolUse
one-liner: Short reminder text for repeated matches
---
```

`queries` and `keywords` are embedded and used for similarity search. `one-liner` is used for graduated disclosure (full content on first match, one-liner on subsequent matches in the same session).

## Configuration

`resolveCoreConfig()` merges a partial config with these defaults:

| Field | Default | Description |
|-------|---------|-------------|
| `enabled` | `true` | Master switch |
| `embeddingModel` | `"Xenova/all-MiniLM-L6-v2"` | Model name for embeddings |
| `embeddingBackend` | `"local"` | `"local"` (ONNX) or `"openai"` |
| `cacheTimeMs` | `300000` (5 min) | How long before `needsRebuild()` returns true |
| `topK` | `3` | Max results per search |
| `threshold` | `0.35` | Minimum similarity score |
| `scoringMode` | `"relative"` | `"relative"` or `"absolute"` |
| `maxDropoff` | `0.1` | Max score gap from best match (relative mode only) |
| `maxInjectedChars` | `8000` | Character budget for injected context |
| `types` | `["skill", "memory", "workflow", "session-learning", "rule"]` | Which entry types to index |
| `skillDirs` | `[]` | Additional skill directories |
| `memoryDirs` | `[]` | Additional memory directories |

Consumers typically extend `MemexCoreConfig` with platform-specific fields (hooks config, sync config, sleep schedule, etc.) and handle file loading themselves.

## Development

```bash
pnpm install --ignore-scripts   # skip onnxruntime postinstall
pnpm test                       # run vitest
pnpm typecheck                  # tsc --noEmit
pnpm lint                       # biome check
pnpm lint:fix                   # biome check --write
pnpm check                      # lint + typecheck + test
pnpm build                      # compile to dist/
```

Note: `pnpm install` without `--ignore-scripts` may fail because `onnxruntime-node` tries to download CUDA binaries in its postinstall. The ONNX runtime loads at runtime, not install time, so this is safe to skip.

## License

MIT

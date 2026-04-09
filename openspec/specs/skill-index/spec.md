## Requirements

### Requirement: ScanDirs names the three index source groups

The skill index baseline SHALL use a `ScanDirs` descriptor with `skillDirs`, `memoryDirs`, and `ruleDirs`, each represented as arrays of directory paths supplied by the consumer.

#### Scenario: Build receives source directories by category

- **WHEN** a caller invokes `SkillIndex.build(scanDirs)`
- **THEN** the index reads skill directories from `scanDirs.skillDirs`, memory directories from `scanDirs.memoryDirs`, and rule directories from `scanDirs.ruleDirs`

### Requirement: parseFrontmatter extracts supported YAML-like metadata and preserves raw bodies when absent

`parseFrontmatter(content)` SHALL parse content wrapped in `---` frontmatter delimiters and return `{ meta, body }`, extracting `name`, `description`, `type`, `queries`, `keywords`, `paths`, `hooks`, `one-liner`, and `boost`. The returned `body` SHALL contain the content after the closing delimiter. If frontmatter delimiters are absent, the function SHALL return `{ meta: {}, body: content }` without modification.

#### Scenario: Frontmatter is present

- **WHEN** markdown begins with a `---` block containing supported keys and ends that block with a second `---`
- **THEN** the parsed metadata is returned in `meta` and the remaining markdown is returned in `body`

#### Scenario: Frontmatter is absent

- **WHEN** content does not match the frontmatter delimiter pattern
- **THEN** `parseFrontmatter` returns an empty `meta` object and the full raw content as `body`

### Requirement: parseFrontmatter supports both block-style and inline list values

For `queries`, `paths`, `hooks`, and `keywords`, `parseFrontmatter` SHALL accept either block-style YAML lists with indented `-` items or inline scalar values. Block-style items and inline values SHALL be normalized into arrays of trimmed strings with surrounding single or double quotes removed.

#### Scenario: Block-style list values are collected

- **WHEN** a supported list key has an empty value followed by indented `- item` lines
- **THEN** each item is appended to the corresponding metadata array in order

#### Scenario: Inline list-like values are treated as single entries

- **WHEN** a supported list key is written on one line with a scalar value
- **THEN** the value is stored as a one-element array for that key

### Requirement: parseMemoryFile supports frontmatter-based and section-based memory formats

`parseMemoryFile(content, filePath)` SHALL support two baseline formats: a frontmatter-based single-entry format using `name`, `description`, and `queries`, and a section-based format that splits on `##` headings and reads `Triggers:` or `Trigger:` lines as queries. The function SHALL return an array of parsed sections with `name`, `description`, `queries`, and trimmed `body`.

#### Scenario: Frontmatter-based memory file yields one parsed entry

- **WHEN** a memory file contains frontmatter with `name` or `description`
- **THEN** `parseMemoryFile` returns at most one parsed section using the declared metadata, defaulting the name to the markdown filename and the description to the first body line when omitted

#### Scenario: Section-based memory file yields one entry per heading

- **WHEN** a memory file contains one or more `## Section Name` headings with optional `Triggers:` lines inside each section
- **THEN** `parseMemoryFile` returns one parsed section per heading, removes trigger lines from the body, and splits comma-separated triggers into normalized query strings

### Requirement: Skill parsing requires name and description and falls back queries to description

When building skill entries from `SKILL.md`, the parser SHALL ignore files missing either `meta.name` or `meta.description`. For valid skill files, the entry type SHALL default to `"skill"` when unspecified, and embedded queries SHALL use `meta.queries` when present or fall back to a single query containing the description.

#### Scenario: Skill file with no explicit queries still indexes

- **WHEN** a `SKILL.md` file has valid `name` and `description` metadata but no `queries`
- **THEN** the index embeds the description as that skill's only query

### Requirement: Rule parsing derives defaults and incorporates keywords into search queries

When building rule entries from markdown files, the parser SHALL default the rule name to the filename without `.md`, default the description to the first line of the parsed body when frontmatter omits it, default `oneLiner` to the description when absent, and add `keywords` to the embedded query list alongside explicit queries. If neither queries nor keywords are present, the description SHALL be used as the sole query.

#### Scenario: Rule file without metadata still produces a searchable rule

- **WHEN** a rule markdown file has no frontmatter name, description, queries, or one-liner
- **THEN** the index uses the filename as the rule name, the first body line as the description and one-liner, and the description as the only embedded query

### Requirement: SkillIndex.build incrementally scans, hydrates, and maintains the index across skills, memories, and rules

`SkillIndex.build(scanDirs)` SHALL load the persistent cache on the first build, hydrate in-memory skills from that cache on a cold start, scan skill directories for `SKILL.md` files in immediate subdirectories, scan memory directories for `.md` files excluding `MEMORY.md`, and scan rule directories for `.md` files. The build SHALL detect new, changed, and deleted files using mtimes and SHALL skip rebuilding unchanged indexes when the previous build is still current.

#### Scenario: First build hydrates from persistent cache

- **WHEN** `build()` runs for the first time and the cache already contains indexed skills for the configured embedding model
- **THEN** the in-memory index is hydrated from cached entries before scanning for changes

#### Scenario: Unchanged sources avoid rebuild work

- **WHEN** all scanned locations have the same mtimes as the last successful build and no locations were added or deleted
- **THEN** `build()` refreshes `buildTime` and returns without re-parsing or re-embedding entries

#### Scenario: Deleted sources are removed from memory and cache

- **WHEN** a previously indexed skill, rule, or memory file is no longer present in scanned locations
- **THEN** the corresponding indexed entries and cached records are removed, including memory section keys derived from that file

### Requirement: Memory files expand into section-keyed entries and new embeddings are generated in batch

During `build()`, each parsed memory section SHALL be indexed as a separate memory entry keyed as `"<path>#<SectionName>"`. For any new or changed skill, rule, or memory section, the index SHALL flatten all queries into a single batch embed call, rebuild the affected `IndexedSkill` records from that batch, and persist the cache after updating embedded entries.

#### Scenario: Memory file yields multiple indexed entries

- **WHEN** a memory file parses into multiple sections
- **THEN** each section is indexed independently under a unique `path#SectionName` location key

#### Scenario: Newly parsed queries are embedded in one batch

- **WHEN** the build includes one or more new or changed entries
- **THEN** the provider receives one flattened batch of all queries for embedding and the cache is saved after the updated entries are written

### Requirement: SkillIndex.search scores all indexed entries, supports filtering, and enforces scoring modes

`SkillIndex.search(query, topK, threshold, typeFilter?, scoringMode?, maxDropoff?)` SHALL embed the incoming query, compute cosine similarity against each indexed query embedding, add any per-entry `boost`, choose the best matching query index per entry, deduplicate results by skill name, and optionally restrict candidates by `typeFilter`. In `relative` mode, the best score SHALL first clear the threshold floor and only results within `maxDropoff` of that best score may remain. In `absolute` mode, each result SHALL individually clear the threshold.

#### Scenario: Duplicate skill names collapse to the highest-scoring entry

- **WHEN** multiple indexed entries share the same skill name across different scan locations
- **THEN** search returns only the highest-scoring result for that name

#### Scenario: Relative scoring uses the best result as the floor anchor

- **WHEN** `scoringMode` is `"relative"` and the top result meets the threshold
- **THEN** search returns up to `topK` results whose scores are no more than `maxDropoff` below the best result

#### Scenario: Absolute scoring enforces per-result thresholding

- **WHEN** `scoringMode` is `"absolute"`
- **THEN** only results whose boosted score is at least the threshold are returned, up to `topK`

### Requirement: readSkillContent returns bodies without frontmatter and resolves memory section references

`SkillIndex.readSkillContent(location)` SHALL read the body content for an indexed location. For ordinary skill or rule files, it SHALL strip frontmatter and return the trimmed body. For memory section references of the form `"path#SectionName"`, it SHALL reparse the memory file and return the trimmed body for the matching section, or an empty string when the section is not found.

#### Scenario: Reading a normal skill strips frontmatter

- **WHEN** `readSkillContent()` is called with a markdown file location
- **THEN** it returns the parsed body content without the frontmatter block

#### Scenario: Reading a memory section resolves by section name

- **WHEN** `readSkillContent()` is called with a `path#SectionName` memory location
- **THEN** it returns the matching section body from `parseMemoryFile`

### Requirement: needsRebuild is driven by first-build state and cache TTL

`SkillIndex.needsRebuild()` SHALL return `true` before the first successful build and thereafter only when the elapsed time since the last build is at least `cacheTimeMs`.

#### Scenario: New index requires an initial build

- **WHEN** no successful build has run yet
- **THEN** `needsRebuild()` returns `true`

#### Scenario: Expired build requires refresh

- **WHEN** the last build time is older than or equal to the configured cache TTL
- **THEN** `needsRebuild()` returns `true`

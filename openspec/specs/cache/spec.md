## Requirements

### Requirement: Cache files use schema version 2 and are keyed by embedding model

The cache schema SHALL be `{ version: 2, embeddingModel, skills }`. `loadCache(cachePath, embeddingModel)` SHALL return an empty valid cache object with `version: 2`, the requested `embeddingModel`, and an empty `skills` map when the cache file is missing, unreadable, malformed, has a different schema version, or was created for a different embedding model.

#### Scenario: Missing or corrupt cache yields an empty cache

- **WHEN** `loadCache(cachePath, embeddingModel)` cannot read or parse the cache file
- **THEN** it returns `{ version: 2, embeddingModel, skills: {} }`

#### Scenario: Model mismatch invalidates the cache

- **WHEN** the on-disk cache was written for a different `embeddingModel`
- **THEN** `loadCache` returns an empty cache for the requested model instead of reusing stored skills

### Requirement: saveCache writes atomically through a temporary file and rename

`saveCache(cachePath, data)` SHALL create the parent directory recursively, write the serialized cache JSON to a temporary file whose name is `<cachePath>.<randomHex>.tmp`, where `<randomHex>` comes from `randomBytes(4).toString("hex")`, and then atomically replace the target path via `rename(tmpPath, cachePath)`.

#### Scenario: Cache writes use a temp-file swap

- **WHEN** `saveCache(cachePath, data)` persists cache data
- **THEN** it writes to a randomly suffixed `.tmp` file first and renames that file to `cachePath`

### Requirement: Cached skills preserve mtime-based reuse metadata

`CachedSkill` entries SHALL store an `mtime` alongside the embedded data so callers can reuse embeddings only when the current file mtime still matches the cached value. `getCachedSkill`, `setCachedSkill`, and `removeCachedSkill` SHALL read, write, and delete cache entries by location key within `cache.skills`.

#### Scenario: Cached entry can gate reuse by file mtime

- **WHEN** a caller retrieves a cached skill whose stored `mtime` matches the current file `mtime`
- **THEN** the caller has the metadata needed to reuse the cached embeddings without re-embedding the file

#### Scenario: Cached entries are keyed by location

- **WHEN** `setCachedSkill(cache, location, skill)` and `getCachedSkill(cache, location)` are used with the same location
- **THEN** the stored `CachedSkill` is returned from `cache.skills[location]`

### Requirement: Cache conversion strips and restores location around persistence

`toCachedSkill(skill, mtime)` SHALL persist the `IndexedSkill` fields except `location`, because the cache key stores that path separately. `fromCachedSkill(location, cached)` SHALL reconstruct an `IndexedSkill` by restoring the supplied `location` while preserving the cached name, description, queries, embeddings, type, `oneLiner`, and `boost` fields.

#### Scenario: Location is omitted from stored CachedSkill values

- **WHEN** `toCachedSkill(skill, mtime)` converts an `IndexedSkill`
- **THEN** the returned `CachedSkill` includes the supplied `mtime` and skill metadata, but not `location`

#### Scenario: Restoring a cached skill reinstates the location key

- **WHEN** `fromCachedSkill(location, cached)` converts a stored cache entry back to an `IndexedSkill`
- **THEN** the returned skill's `location` is the supplied key and its remaining fields come from `cached`

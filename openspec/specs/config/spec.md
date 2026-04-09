## Requirements

### Requirement: The core config exposes fixed baseline defaults

`DEFAULT_CORE_CONFIG` SHALL provide these defaults: `enabled: true`, `embeddingModel: "Xenova/all-MiniLM-L6-v2"`, `embeddingBackend: "local"`, `cacheTimeMs: 300000`, `topK: 3`, `threshold: 0.35`, `scoringMode: "relative"`, `maxDropoff: 0.1`, `maxInjectedChars: 8000`, `types: ["skill", "memory", "workflow", "session-learning", "rule"]`, `skillDirs: []`, and `memoryDirs: []`.

#### Scenario: Default config is used as the baseline

- **WHEN** the package exports `DEFAULT_CORE_CONFIG`
- **THEN** it contains the documented default values for all core config fields

### Requirement: resolveCoreConfig merges partial config with runtime type checks

`resolveCoreConfig(partial?)` SHALL return a shallow copy of `DEFAULT_CORE_CONFIG` when `partial` is omitted. When `partial` is provided, it SHALL merge field-by-field using runtime checks: `enabled` only accepts booleans, `embeddingModel` only accepts strings, `embeddingBackend` only accepts the literal `"openai"` and otherwise falls back to the default `"local"`, numeric fields (`cacheTimeMs`, `topK`, `threshold`, `maxDropoff`, `maxInjectedChars`) only accept numbers, `scoringMode` only accepts the literal `"absolute"` and otherwise falls back to the default `"relative"`, `types` accepts any array value as-is, and `skillDirs` / `memoryDirs` accept arrays whose elements are coerced with `String(...)`.

#### Scenario: Omitted partial returns a cloned default config

- **WHEN** `resolveCoreConfig()` is called without arguments
- **THEN** it returns a new object with the same field values as `DEFAULT_CORE_CONFIG`

#### Scenario: Valid overrides replace defaults

- **WHEN** `resolveCoreConfig(partial)` is called with correctly typed override values
- **THEN** those fields replace the defaults in the returned config

#### Scenario: Invalid override types fall back to defaults

- **WHEN** `resolveCoreConfig(partial)` receives values of the wrong runtime type for a field
- **THEN** that field in the returned config falls back to `DEFAULT_CORE_CONFIG`

#### Scenario: Directory arrays are string-coerced element by element

- **WHEN** `resolveCoreConfig(partial)` receives `skillDirs` or `memoryDirs` as arrays
- **THEN** the returned arrays contain `String(...)` of each supplied element

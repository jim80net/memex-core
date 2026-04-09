## Requirements

### Requirement: loadRegistry returns version 1 registry data and falls back to empty data on invalid input

`loadRegistry(registryPath)` SHALL read JSON registry data from disk and expect the version 1 schema `{ version: 1, projects: {} }`. If the file is missing, unreadable, malformed, or has a version other than `1`, the function SHALL return an empty version 1 registry object.

#### Scenario: Corrupt or mismatched registry data is ignored

- **WHEN** the registry file is invalid JSON or declares a version other than `1`
- **THEN** `loadRegistry` returns `{ version: 1, projects: {} }`

### Requirement: saveRegistry writes atomically, creates parent directories, and pretty-prints JSON

`saveRegistry(registryPath, data)` SHALL create the destination parent directory if needed, write the registry as pretty-printed JSON to a uniquely suffixed temporary file, and rename that temp file into place to complete the save atomically.

#### Scenario: Registry save creates missing parent directories

- **WHEN** the parent directory for `registryPath` does not exist
- **THEN** `saveRegistry` creates it before writing and renaming the temporary file

### Requirement: registerProject mutates the registry in place with an ISO lastSeen timestamp

`registerProject(registry, cwd)` SHALL mutate the provided registry object in place and store the project under `registry.projects[cwd]` with a `lastSeen` timestamp generated in ISO 8601 string form.

#### Scenario: Registering a project updates lastSeen for that cwd

- **WHEN** `registerProject` is called for a project path, including one already present in the registry
- **THEN** the registry stores that cwd with a fresh ISO-formatted `lastSeen` value

### Requirement: getKnownProjects returns project paths ordered by recency

`getKnownProjects(registry)` SHALL return the known project paths sorted by descending `lastSeen`, so the most recently seen project appears first.

#### Scenario: Projects are returned most-recent-first

- **WHEN** the registry contains multiple projects with different `lastSeen` values
- **THEN** `getKnownProjects` returns their paths ordered from newest timestamp to oldest timestamp

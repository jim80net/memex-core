## Requirements

### Requirement: encodeProjectPath transforms absolute paths to safe directory names

`encodeProjectPath(cwd)` SHALL transform an absolute filesystem path into a directory-name-safe string by replacing `/`, `.`, and `_` characters with `-` (hyphen). Consecutive hyphens are preserved because they encode original dots and separators.

#### Scenario: Typical Unix path

- **WHEN** `encodeProjectPath("/home/user/.myproject")` is called
- **THEN** the result is `"-home-user--myproject"`

#### Scenario: Path with underscores

- **WHEN** `encodeProjectPath("/Users/jim/work/my_project")` is called
- **THEN** the result is `"-Users-jim-work-my-project"`

#### Scenario: Root path

- **WHEN** `encodeProjectPath("/")` is called
- **THEN** the result is `"-"`

#### Scenario: Path used in _local fallback

- **WHEN** `resolveProjectId` falls through to the encoded path fallback for `/home/me/work`
- **THEN** the resulting project ID contains `"_local/-home-me-work"` as the encoded segment
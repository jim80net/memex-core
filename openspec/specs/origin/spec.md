## Requirements

### Requirement: resolveOriginRoot follows the locked precedence chain

`resolveOriginRoot(opts?)` SHALL resolve the shared origin root using this precedence: (1) explicit `opts.root` (absolute or `~/…` expanded against `opts.homeDir` or `homedir()`), (2) environment variable `MEMEX_ORIGIN` from `opts.env` or `process.env`, (3) existing `~/.memex`, (4) existing `~/.local/share/memex`, (5) existing `~/.local/share/memex-claude`, (6) product default `~/.memex` even when missing. It SHALL return `{ root, source, exists }` where `source` is one of `explicit` | `env` | `default` | `xdg` | `legacy-claude`.

#### Scenario: Explicit root wins over env and filesystem

- **WHEN** `opts.root` is a non-empty path
- **THEN** the resolved `source` is `"explicit"` and `root` is the absolute expansion of that path

#### Scenario: Missing paths fall back to product default

- **WHEN** no explicit root, no `MEMEX_ORIGIN`, and none of `~/.memex`, XDG `memex`, or `memex-claude` exist
- **THEN** `root` is `~/.memex`, `source` is `"default"`, and `exists` is `false`

### Requirement: planProjection never plans clobber of real harness files

`planProjection(originRoot, targets, opts?)` SHALL enumerate origin entries per target (`files` by suffix, default `*.md`; `skill-dirs` as child directories containing `SKILL.md`), classify each destination with `lstat`, and emit `create` / `relink` / `noop` link actions or a conflict reason. Real files and real directories SHALL become conflicts (`real-file` / `real-dir`). Symlinks pointing outside the origin root SHALL become `foreign-symlink` (or `broken-unmanaged` when broken and unmanaged). Symlinks under the origin root MAY be planned as `relink` when `relinkManaged` is true (default).

#### Scenario: Real file at target is a conflict

- **WHEN** the harness path exists as a non-symlink file
- **THEN** the plan records a conflict with reason `"real-file"` and does not include a create/relink action for that path

#### Scenario: Matching absolute symlink is noop

- **WHEN** the harness path is a symlink whose absolute target equals the origin entry path
- **THEN** the plan records action `"noop"` for that path

### Requirement: applyProjection uses absolute symlinks and partial apply

`applyProjection(plan)` SHALL create directories listed in `plan.ensureDirs`, apply every non-`noop` link in `plan.links` as an **absolute** symlink from target → origin path, leave conflicted paths untouched, and return `{ linked, skipped, conflicts }` where `conflicts` mirrors `plan.conflicts`. It MUST NOT delete or overwrite non-symlink files.

#### Scenario: Partial success when one entry conflicts

- **WHEN** the plan has one conflict and one create link
- **THEN** apply creates the non-conflicted symlink, leaves the conflicted real file intact, and returns `linked === 1` with the conflict preserved in the report

### Requirement: materializeEntry writes under origin with containment

`materializeEntry(originRoot, input)` SHALL resolve `input.originRelPath` under `originRoot` with traversal rejection (no absolute rel paths; no `..` escape), hold a per-file lock, create parent directories, and write `input.content`. It SHALL return `created`, `updated`, or `unchanged` on success. When `failIfChanged` is true and the destination exists with different content, it SHALL return `status: "conflict"`.

#### Scenario: Path traversal is rejected

- **WHEN** `originRelPath` is `../escape.md`
- **THEN** `materializeEntry` throws before writing

#### Scenario: Identical content is unchanged

- **WHEN** the destination already contains exactly `input.content`
- **THEN** the result status is `"unchanged"` and the file is not rewritten as a change

### Requirement: migrateOriginToDefault installs optional legacy compat symlink

`migrateOriginToDefault` SHALL rename an existing source origin (default `~/.local/share/memex-claude`) to `~/.memex` when the destination is missing, and when `installCompatSymlink` is not false SHALL create a symlink from the legacy path to the new default. `installLegacyOriginCompatSymlink` SHALL fail closed with `"conflict"` when the legacy path is a real directory or file.

#### Scenario: Legacy directory is not deleted for a compat symlink

- **WHEN** `installLegacyOriginCompatSymlink` is called and the legacy path is a real directory containing files
- **THEN** the result is `"conflict"` and the directory contents remain

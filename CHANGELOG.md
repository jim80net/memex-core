# Changelog

## Unreleased

### ⚠ BREAKING CHANGES

* `normalizeGitUrl` now lowercases its output by default. Library consumers
  who depended on the previous case-preserving behavior must pass
  `caseSensitive: true` as the second argument to restore it.

### Features

* `SyncConfig.caseSensitive` optional flag (default `false`) controlling
  case handling in `resolveProjectId`. Project IDs are now lowercased by
  default across all three resolution paths.
* `runSyncMigrations` and `migrateProjectIdsToLowercase` exported from
  the public API for CLI diagnostics.
* One-shot migration of existing mixed-case sync repo contents, gated by
  a new `.memex-sync/version.json` schema marker. Runs automatically on
  first `syncPull` after upgrade.
* Case-insensitive fallback in `findMatchingProjectMemoryDirs` to cover
  the rollout window between library upgrade and first post-upgrade sync.

### Bug Fixes

* Git helper functions extracted from `src/sync.ts` into a new internal
  `src/git-helpers.ts` module (no API change).

## [0.5.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.4.0...memex-core-v0.5.0) (2026-04-09)


### Features

* **openspec:** backport existing functionality into baseline specs ([#21](https://github.com/jim80net/memex-core/issues/21)) ([ae92945](https://github.com/jim80net/memex-core/commit/ae9294548d975a0385e0317f18d5550b6b87c29e))

## [0.4.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.3.1...memex-core-v0.4.0) (2026-04-08)


### Features

* **sync:** case-insensitive project IDs with one-shot migration ([#17](https://github.com/jim80net/memex-core/issues/17)) ([2c3f6d1](https://github.com/jim80net/memex-core/commit/2c3f6d136a56514c1d3ea7813fcf344458684599))

## [0.3.1](https://github.com/jim80net/memex-core/compare/memex-core-v0.3.0...memex-core-v0.3.1) (2026-03-17)


### Bug Fixes

* deduplicate search results by skill name ([#14](https://github.com/jim80net/memex-core/issues/14)) ([bf95eeb](https://github.com/jim80net/memex-core/commit/bf95eeb3091f3cad7c1912a04fa15f8c6a010777))

## [0.3.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.2.3...memex-core-v0.3.0) (2026-03-16)


### Features

* add GEPA foundation — Observation type, query attribution, boost, telemetry reports ([#12](https://github.com/jim80net/memex-core/issues/12)) ([36d47f5](https://github.com/jim80net/memex-core/commit/36d47f51984111aa7e038c818cd948c6d1899f5d))

## [0.2.3](https://github.com/jim80net/memex-core/compare/memex-core-v0.2.2...memex-core-v0.2.3) (2026-03-16)


### Bug Fixes

* parseMemoryFile now handles frontmatter-based memory files ([#10](https://github.com/jim80net/memex-core/issues/10)) ([2b98dd8](https://github.com/jim80net/memex-core/commit/2b98dd85b968bf2c2a0c333bb807144a5600cd84))

## [0.2.2](https://github.com/jim80net/memex-core/compare/memex-core-v0.2.1...memex-core-v0.2.2) (2026-03-15)


### Bug Fixes

* add repository URL for npm provenance verification ([616e325](https://github.com/jim80net/memex-core/commit/616e325aabfa01ea42647e59fad794da20a7efa9))
* add repository URL for npm provenance verification ([1c3f728](https://github.com/jim80net/memex-core/commit/1c3f728a8116fdd67894bbab48730fd664bf870b))

## [0.2.1](https://github.com/jim80net/memex-core/compare/memex-core-v0.2.0...memex-core-v0.2.1) (2026-03-15)


### Bug Fixes

* add NPM_TOKEN for npm publish authentication ([6b7ba38](https://github.com/jim80net/memex-core/commit/6b7ba38fde3f08cbe54fa1b2b5ac2215ba3d96b1))
* use npm OIDC trusted publishing instead of token auth ([4b6d379](https://github.com/jim80net/memex-core/commit/4b6d379afb5a63283160b365a432d1c6067eda6e))
* use npm OIDC trusted publishing instead of token auth ([dee6e5e](https://github.com/jim80net/memex-core/commit/dee6e5e265d8148cbe55d3e5ad086bb7e206ca66))

## [0.2.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.1.0...memex-core-v0.2.0) (2026-03-15)


### Features

* add globalSkillsDir and globalRulesDir to MemexPaths ([1226938](https://github.com/jim80net/memex-core/commit/1226938b16df54e972c9a2e705d8d4382f87bac1))
* add README, CI workflows, and globalSkillsDir/globalRulesDir to MemexPaths ([082aafc](https://github.com/jim80net/memex-core/commit/082aafc033159baf89b2277f4ad6c8e26d3905fd))
* initial @jim80net/memex-core package ([8e2d2dc](https://github.com/jim80net/memex-core/commit/8e2d2dc09640fc3e44c2c0cb8bef12cc9343e0fe))


### Bug Fixes

* remove NPM_TOKEN secret, use OIDC trusted publishing only ([2fbbcc8](https://github.com/jim80net/memex-core/commit/2fbbcc8c6309d1d5cd89964d35ac9510359e3b4c))

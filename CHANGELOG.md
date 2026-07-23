# Changelog

## Unreleased

### Features

* **origin:** shared origin primitives for file-shaped projection
  (`resolveOriginRoot`, `planProjection` / `applyProjection`,
  `materializeEntry`, `commitOriginPaths`, migrate + one-release
  `memex-claude` → `~/.memex` compat symlink). Design:
  `design/shared-origin-sync-profile.md` (XO-gated). Absolute symlinks v1;
  partial apply + report conflicts; never clobber real harness files.

## [0.7.2](https://github.com/jim80net/memex-core/compare/memex-core-v0.7.1...memex-core-v0.7.2) (2026-07-23)


### Bug Fixes

* support bundled embedding runtimes ([#51](https://github.com/jim80net/memex-core/issues/51)) ([7d612c2](https://github.com/jim80net/memex-core/commit/7d612c233821a4c3776645e4e32722c9a857d498))

## [0.7.1](https://github.com/jim80net/memex-core/compare/memex-core-v0.7.0...memex-core-v0.7.1) (2026-07-23)


### Bug Fixes

* fail closed on vulnerable sharp ([#50](https://github.com/jim80net/memex-core/issues/50)) ([5a34508](https://github.com/jim80net/memex-core/commit/5a345089bb4b0c95310231d6341ca65c5e23f3dd))
* settle SkillIndex cache writes ([#48](https://github.com/jim80net/memex-core/issues/48)) ([3955e41](https://github.com/jim80net/memex-core/commit/3955e4182729c6b808f9cbf83422405668281575))

## [0.7.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.6.1...memex-core-v0.7.0) (2026-07-23)


### Features

* add audit-contracts --json command ([#44](https://github.com/jim80net/memex-core/issues/44)) ([4612869](https://github.com/jim80net/memex-core/commit/4612869ca60b80cafc2e11720b4f7fa7c75d5cbe))

## [0.6.1](https://github.com/jim80net/memex-core/compare/memex-core-v0.6.0...memex-core-v0.6.1) (2026-07-19)


### Bug Fixes

* enforce retired lifecycle across search and projection ([#40](https://github.com/jim80net/memex-core/issues/40)) ([d8748d1](https://github.com/jim80net/memex-core/commit/d8748d18dcd86c3f8fa0e6b743ba27d8ab5c05ac))
* parse YAML block scalar descriptions consistently across search and projection ([#41](https://github.com/jim80net/memex-core/issues/41)) ([c8824c0](https://github.com/jim80net/memex-core/commit/c8824c0e362dbfe58be8d60b415e2118417cee90))

## [0.6.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.5.0...memex-core-v0.6.0) (2026-07-10)


### Features

* **origin:** shared origin root, projection, and materialize primitives ([#35](https://github.com/jim80net/memex-core/issues/35)) ([71af822](https://github.com/jim80net/memex-core/commit/71af8229c875ef0ad4c6fc1c398672ca20486647))

## [0.5.0](https://github.com/jim80net/memex-core/compare/memex-core-v0.4.0...memex-core-v0.5.0) (2026-07-06)


### Features

* **openspec:** backport existing functionality into baseline specs ([#21](https://github.com/jim80net/memex-core/issues/21)) ([ae92945](https://github.com/jim80net/memex-core/commit/ae9294548d975a0385e0317f18d5550b6b87c29e))
* **skill-index:** portable location handles at index time ([#32](https://github.com/jim80net/memex-core/issues/32) Phase 1) ([#33](https://github.com/jim80net/memex-core/issues/33)) ([d211719](https://github.com/jim80net/memex-core/commit/d2117195c6ab22e910e12bbda0d9046525d62309))

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

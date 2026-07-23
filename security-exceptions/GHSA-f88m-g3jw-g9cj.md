# GHSA-f88m-g3jw-g9cj temporary dependency-graph exception

- Owner: <https://github.com/jim80net/memex-core/issues/46>
- Recorded: 2026-07-23
- Expires: 2026-08-06
- Status: open; adapter Core 0.7.0 rollout remains held pending independent resolution

## Finding

The published `@jim80net/memex-core@0.7.0` dependency graph resolves
`@huggingface/transformers@3.8.1` and `sharp@0.34.5`. GitHub advisory
GHSA-f88m-g3jw-g9cj marks `sharp <0.35.0` vulnerable through bundled libvips
and identifies `0.35.0` as the first patched release.

As of 2026-07-23, the latest `@huggingface/transformers@4.2.0` still declares
`sharp ^0.34.5`. Adding a direct `sharp@0.35.x` dependency produces a second
installation and does not remove Transformers' vulnerable nested copy.
Package-level npm overrides also do not propagate to consumers.

## Reachability and control

Transformers' Node bundle imports Sharp at module initialization. A clean
registry install of Core 0.7.0 loaded `sharp@0.34.5`, `libvips 8.17.3`, and
`sharp-linux-arm64.node` before any image operation. Core exposes only the
text-only `feature-extraction` pipeline, so it does not pass attacker-controlled
image bytes to Sharp, but the affected native library is nevertheless loaded.

Core now resolves and checks the Sharp package version before importing
Transformers. Local embeddings fail closed unless the resolved version is a
stable `>=0.35.0`; an unresolvable or unverifiable version also fails closed.
This prevents Core from loading the vulnerable native module. Consumers may
use an application-owned override to a compatible patched Sharp while upstream
widens its declared range.

## Residual scanner result and exit

`npm audit` continues to report the metadata dependency path as high severity
because Transformers' published range remains on `0.34.x`. This exception
covers that scanner result only; it does not permit loading Sharp below 0.35.0.

Validation on 2026-07-23:

- clean registry Core 0.7.0 install: 3 high, 0 critical, no fix available;
- patched packed install on the stock graph: rejected Sharp 0.34.5 with zero
  executable/native Sharp modules loaded;
- patched packed install with application override `sharp@0.35.3`: 0 audit
  findings and local embedding initialization proceeded beyond the guard;
- Core: 217 tests, typecheck, lint, and build passed;
- Grok, Claude, Hermes, and OpenClaw: 492 tests passed, 8 integration tests
  skipped, with all applicable typecheck and lint gates passed.

Close this exception before its expiry when Transformers publishes a release
whose Sharp range admits `>=0.35.0`, then update the optional dependency and
lockfile, remove the runtime incompatibility, rerun Core/pack/install/audit and
all adapter compatibility gates, and independently reconcile issue #46.

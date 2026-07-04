# Design — three-tier knowledge SCOPE (desk / flotilla / fleet)

**Status:** proposed (operator directive 2026-07-04)
**Owner:** memex-core (resolution + corpus layout); adapters consume
**Related:** `knowledge-lifecycle-centroid.md` (TRUST tier — orthogonal axis)

## Problem

Skills, rules, and standing memory must apply at different breadths:

- Some belong to **one desk** (one git repo / worktree)
- Some belong to a **flotilla** (all desks under one project-XO — e.g. product lane, empath venture)
- Some belong to the **fleet** (operator-global — equated with user-level standing rules)

Today the sync corpus is mostly `projects/<id>/` plus ad-hoc `rules/` and `skills/`
at repo root. There is no first-class **flotilla** bucket, and fleet-global vs
project-local is implicit.

## Corpus layout (proposed)

```
<sync-repo>/
  fleet/           # operator-global (user-level): constitution, standing rules
    rules/
    skills/
  flotillas/
    <flotilla-id>/ # project-XO scope: flotilla-dev, empath, memex, …
      rules/
      skills/
  projects/
    <canonical-id>/  # desk scope (existing)
      memory/
      skills/
      rules/
```

`flotilla-id` is a stable generic slug from roster topology (e.g. the project-XO
agent name or a configured `flotilla` field) — not a deployment-specific codename in
public docs.

## Resolution API (memex-core)

At index / search time, given:

- `cwd` — resolves desk scope (`resolveProjectId`, existing)
- `flotillaId` — optional; from adapter reading `FLOTILLA_SELF` + roster parent XO
- `includeFleet` — default true for TRUSTED tier

`SkillIndex.build()` scans **union** of applicable scope directories, with precedence:

**fleet < flotilla < desk** (narrower wins on ID collision; tag entries with `scope:` in frontmatter).

## Harness notes

| Harness | Injection | Scope delivery |
|---------|-----------|----------------|
| Claude | hooks + rules loop | filesystem + hook additionalContext |
| Codex | hooks (`hookSpecificOutput`) | filesystem + hook |
| Grok | **none** (MCP + sync only) | filesystem sync + MCP search/read |
| Hermes | init + system prompt | filesystem + prefetch |

Grok adapters MUST NOT assume hook injection; fleet/flotilla TRUSTED rules reach Grok
desks only via synced files the MCP server indexes.

## Out of scope (v1)

- Automatic flotilla-id inference without roster — adapters pass what they know
- flotilla#131 KMS unification — this doc is the memex corpus slice only
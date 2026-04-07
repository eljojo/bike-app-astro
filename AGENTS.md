# whereto.bike

Open-source cycling platform — the WordPress for cycling. One codebase, three modes: personal ride blogs, community route wikis, and randonneuring club archives. City-specific instances, community-maintained, multilingual by default. AGPL-licensed.

`CLAUDE.md` is a symlink to this file (`AGENTS.md`). Detail context lives in `_ctx/` — see the [Context Index](#context) below.

## Why This Exists

1. **Increase the number of first-time bicycle riders.**
2. **Tap into experienced riders to help achieve goal 1.**

Every product decision, every line of copy, every feature choice passes through these two goals. When two approaches both work, choose the one that results in more people riding.

## Who This Is For

Someone who loves cycling wants to share it with someone they care about. They need the right ride — not too far, good surface, maybe a bakery at the turnaround point. The information has to be truthful, because this is how cycling clicks for a new person. Not through arguments or marketing, but through one good ride.

A bicycle for the mind already exists. This is the other half.

## Ownership Mindset

You own the outcome, not just the task.

- **You are an AI and you will be wrong.** Your confidence is not evidence. Your first theory is almost certainly wrong. If you haven't run the code, queried the data, or checked the output, you don't know — you're guessing. Guessing with confidence is worse than admitting uncertainty, because it wastes time. When you catch yourself reasoning about what "should" happen, stop and verify what actually happens.
- **Verify before claiming anything.** Show proof, not theories. Run the command. Read the output. Query the data. If you can check it, check it — don't reason about it. The cost of verification is minutes; the cost of a wrong theory is hours of going in circles.
- **The user's observations are ground truth.** Their report of what they see IS what's happening. Your mental model is a theory; their observation is a fact. Never make the user prove what they told you.
- **When the user says fix it, fix it.** Don't defer, minimize, or propose "picking this up later."
- **Search before creating.** Grep first. One source of truth.
- **Trace all connections.** Find every reference before removing or changing something.
- **Delete, don't hide.** No commented-out code, no CSS hiding, no dead conditionals.
- **Don't shrug off broken things.** A failure is your problem to solve. "Pre-existing" is not a status — it's an excuse.
- **Never substitute a nearby easier question.** If the user asked "why does this happen?" and you're about to write code that makes it stop — stop. Investigation first.
- **Never silently change output medium.** If they asked for analysis in chat, don't write a file.

## When Things Go Wrong

If the user says "you're drifting", "stop and listen", "that's not what I asked", or corrects you more than twice:
  **Follow the [drift correction protocol](_ctx/protocol-drift-correction.md).**

Before claiming work is complete:
  **Follow the [verification protocol](_ctx/protocol-verify-before-done.md).**

**NEVER run `git stash`, `git checkout --`, `git restore`, `git reset --hard`, or any command that discards uncommitted work.**
  These commands are irreversible and can destroy the user's in-progress work on unrelated tasks.
  If you think you need to discard changes: STOP. Read the [destructive actions protocol](_ctx/protocol-destructive-actions.md). List every affected file. Explain why. Ask for explicit confirmation. There are no exceptions.

## Mandatory Rules

- **No bracket filenames.** NEVER create `[slug].astro` or `[id].ts`. Dynamic routes use `injectRoute()`. Views live in `src/views/`.
- **Vendor isolation.** NEVER import platform modules directly. See [vendor-isolation](_ctx/vendor-isolation.md).
- **Authorize every endpoint.** Every API endpoint MUST call `authorize()`. ESLint enforces this.
- **Server boundary.** `.server.ts` = server-only. Plain `.ts` = browser-safe. ESLint enforces this. See [server-boundary](_ctx/server-boundary.md).
- **Never hardcode city/locale.** Import `CITY` from `src/lib/config/config.ts`. Check city config for locales.
- **No deprecated Sass.** Use `color.adjust()`/`color.scale()` from `sass:color`, never `lighten()`/`darken()`. See [css-styling](_ctx/css-styling.md).
- **Zod v4.** Import from `zod/v4`, not `zod` or `astro/zod`.
- **Prerender flags.** Every page/endpoint MUST export `prerender` (true or false).
- **Content model layer.** All content data goes through `src/lib/models/`. Never hand-roll JSON serialization.
- **Virtual module types.** `src/virtual-modules.d.ts` is ambient — NO top-level imports.

## Quick Start

```sh
nix develop        # enter dev shell
make install       # npm install
make dev           # astro dev on localhost:4321
```

All commands MUST run inside `nix develop`.

## Testing

```sh
make lint          # ESLint
make typecheck     # tsc --noEmit
make test          # vitest unit tests
make test-e2e      # build (CITY=demo) + playwright
make full          # everything
```

Run `make lint && make typecheck` before committing. See [test-quality](_ctx/test-quality.md) for test writing rules.

## Related Repos

- `~/code/bike-app` — Plans/design docs in `docs/plans/`
- `~/code/bike-routes` — Content data repo
- `~/code/bike-routes-golden-tests` — Golden test artifacts

## Environment Variables

See `.env.example`. Key: `RUNTIME=local` for offline dev, `CONTENT_DIR` for data repo, `CITY` for city selection.

---

## Always Read

**Read these five files at the start of every session. This is not optional.** They prevent catastrophic mistakes and provide foundational knowledge required for any task.

- [protocol-destructive-actions](_ctx/protocol-destructive-actions.md) — before any git command that modifies working tree: list files, explain, confirm
- [git-conventions](_ctx/git-conventions.md) — commit granularity, no co-author, no auto-commit, no push unless told
- [domain-model](_ctx/domain-model.md) — the cycling domain: entities, relationships, why truthful modelling matters
- [architecture-principles](_ctx/architecture-principles.md) — Static is Sacred, Develop on a Train, Data Locality, Tags as Behaviour
- [codex-reference](_ctx/codex-reference.md) — how to use Codex for second opinions, debugging, and review

---

## Context

This repo uses a knowledge base system in `_ctx/`. The always-read files above are loaded every session. The files below are loaded when their topic matches the current task — read the one-line description to decide if you need the full file. See [context-system](_ctx/context-system.md) for the full loading protocol, maintenance process, and how to add new files.

### Vision
Long-term direction. Read to understand *why* decisions are made.
- [development-principles](_ctx/development-principles.md) — empathy, universality, show don't tell, domain-driven design, durability
- [public-design-language](_ctx/public-design-language.md) — the iPod for cycling; restraint and warmth, progressive revelation, physical metaphors
- [admin-design-language](_ctx/admin-design-language.md) — Keynote not Numbers; inevitability with personality, warm darks
- [voice-and-feel](_ctx/voice-and-feel.md) — friend showing you around; no exclamation marks, no absolute fitness language
- [brand-framing](_ctx/brand-framing.md) — whereto.bike umbrella, instance types, positioning
- [stats-philosophy](_ctx/stats-philosophy.md) — "this is liked" not "this performs"; community relationship, not metrics

### Knowledge
How the app works. Read to understand *what* things are.
- [context-system](_ctx/context-system.md) — how the _ctx/ knowledge base works: philosophy, loading tiers, types, maintenance
- [content-model](_ctx/content-model.md) — model schemas as source of truth, content type registry, ContentOps, GitFiles
- [config-layers](_ctx/config-layers.md) — build-time vs runtime config, city config YAML, AppEnv, build-time transforms
- [instance-types](_ctx/instance-types.md) — wiki/blog/club, feature flags vs identity checks
- [save-pipeline](_ctx/save-pipeline.md) — SaveHandlers factory, conflict detection, D1 cache overlay
- [virtual-modules](_ctx/virtual-modules.md) — build-data-plugin, ambient types, how to add new ones
- [i18n](_ctx/i18n.md) — three layers (UI strings, URL paths, content sidecars)
- [media-pipeline](_ctx/media-pipeline.md) — R2 storage, video transcoding, universal media pattern
- [blog-instance](_ctx/blog-instance.md) — blog city is always blog/, CITY=blog, consumer repo, sync.js
- [bike-paths](_ctx/bike-paths.md) — how bikepaths.yml (OSM) and markdown cooperate, overlay model, networks
- [bike-path-tiles](_ctx/bike-path-tiles.md) — adaptive quadtree tiles with baked metadata, client-side tile loading
- [pipeline-overview](_ctx/pipeline-overview.md) — how the bikepaths pipeline discovers, names, clusters, and networks cycling infrastructure
- [naming-unnamed-chains](_ctx/naming-unnamed-chains.md) — how the pipeline names unnamed chains from nearby parks/roads
- [path-types](_ctx/path-types.md) — path_type field: classifies infrastructure by safety and bike requirements
- [entry-types](_ctx/entry-types.md) — type field: network, destination, infrastructure, connector
- [markdown-overrides](_ctx/markdown-overrides.md) — how markdown frontmatter is consumed by pipeline and app
- [adding-new-things](_ctx/adding-new-things.md) — checklists for content types, endpoints, routes, tables, virtual modules, islands
- [ci-cd](_ctx/ci-cd.md) — workflows, deploy matrix, screenshot auto-update
- [css-styling](_ctx/css-styling.md) — SCSS variables, dark mode, colocated styles, admin.scss
- [e2e-testing](_ctx/e2e-testing.md) — fixtures, hydration waits, screenshot conventions

### Rules
Non-negotiable constraints. Violations are bugs.
- [vendor-isolation](_ctx/vendor-isolation.md) — every cloud service behind an adapter; 6 boundary points
- [server-boundary](_ctx/server-boundary.md) — .server.ts naming, what can import what, ESLint enforcement
- [spatial-reasoning](_ctx/spatial-reasoning.md) — NEVER use midpoints, centers, anchors, or bboxes as proxy for real geometry
- [test-quality](_ctx/test-quality.md) — real SQLite not mocks, assert known values, break code to validate

### Safety
Procedures that prevent catastrophic mistakes. Follow when triggered.
- [protocol-drift-correction](_ctx/protocol-drift-correction.md) — when drifting: stop, restate, re-read, verify match
- [protocol-verify-before-done](_ctx/protocol-verify-before-done.md) — run verification commands, show output, never claim without evidence
- [protocol-ctx-maintenance](_ctx/protocol-ctx-maintenance.md) — light per-session and deep periodic review of _ctx/ knowledge base

### Gotchas
Known traps. Read when touching the relevant area.
- [platform-gotchas](_ctx/platform-gotchas.md) — Cloudflare fetch deadlock, Rollup dead-code, Preact hydration, CSP
- [preact-islands](_ctx/preact-islands.md) — textarea bug, scoped CSS pitfall, useHydrated, content hash sync
- [astro-cloudflare](_ctx/astro-cloudflare.md) — wrangler config, renderer stripping, cache versioning, import.meta.dirname

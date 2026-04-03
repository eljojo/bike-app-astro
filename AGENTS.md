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

- **You are an AI and you will be wrong.** Your confidence is not evidence. When debugging goes in circles, stop and question the mechanism.
- **The user's observations are ground truth.** Their report of what they see IS what's happening. Your mental model is a theory; their observation is a fact. Never make the user prove what they told you.
- **When the user says fix it, fix it.** Don't defer, minimize, or propose "picking this up later."
- **Verify before claiming done.** Show proof, not promises. Paste the actual output.
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

Before any git command that discards or moves uncommitted work:
  **Follow the [destructive actions protocol](_ctx/protocol-destructive-actions.md).**

## Mandatory Rules

- **No bracket filenames.** NEVER create `[slug].astro` or `[id].ts`. Dynamic routes use `injectRoute()`. Views live in `src/views/`.
- **Vendor isolation.** NEVER import platform modules directly. See [vendor-isolation](_ctx/vendor-isolation.md).
- **Authorize every endpoint.** Every API endpoint MUST call `authorize()`. ESLint enforces this.
- **Server boundary.** `.server.ts` = server-only. Plain `.ts` = browser-safe. ESLint enforces this. See [server-boundary](_ctx/server-boundary.md).
- **Never hardcode city/locale.** Import `CITY` from `src/lib/config/config.ts`. Check city config for locales.
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

## Context

This repo uses a two-tier context system. The rules and mindset above are always active. The files below contain detail for specific tasks — read the one-line description to decide if you need the full file. Files with `type: protocol` are step-by-step procedures to follow when triggered. Files with `type: rule` are non-negotiable. Files with `type: pattern` or `type: guide` inform your approach. Each file has a `triggers` field in its frontmatter listing when to load it. See [context-system](_ctx/context-system.md) for the full loading protocol and maintenance rules.

### Protocols
- [protocol-drift-correction](_ctx/protocol-drift-correction.md) — when drifting: stop, restate, re-read, verify match
- [protocol-verify-before-done](_ctx/protocol-verify-before-done.md) — run verification commands, show output, never claim without evidence
- [protocol-destructive-actions](_ctx/protocol-destructive-actions.md) — before git stash/checkout/reset/push: list files, explain, confirm

### Rules
- [vendor-isolation](_ctx/vendor-isolation.md) — every cloud service behind an adapter; 6 boundary points
- [server-boundary](_ctx/server-boundary.md) — .server.ts naming, what can import what, ESLint enforcement
- [git-conventions](_ctx/git-conventions.md) — commit granularity, no co-author, message style
- [test-quality](_ctx/test-quality.md) — real SQLite not mocks, assert known values, break code to validate

### Patterns
- [save-pipeline](_ctx/save-pipeline.md) — SaveHandlers factory, conflict detection, D1 cache overlay
- [domain-model](_ctx/domain-model.md) — the cycling domain: entities, relationships, why truthful modelling matters
- [content-model](_ctx/content-model.md) — model schemas as source of truth, content type registry
- [virtual-modules](_ctx/virtual-modules.md) — build-data-plugin, ambient types, how to add new ones
- [instance-types](_ctx/instance-types.md) — wiki/blog/club, feature flags vs identity checks
- [ci-cd](_ctx/ci-cd.md) — workflows, deploy matrix, screenshot auto-update
- [adding-new-things](_ctx/adding-new-things.md) — checklists for content types, endpoints, routes, tables
- [media-pipeline](_ctx/media-pipeline.md) — R2 storage, video transcoding, universal media pattern
- [i18n](_ctx/i18n.md) — three layers (UI strings, URL paths, content sidecars)
- [config-layers](_ctx/config-layers.md) — build-time vs runtime config, city config, AppEnv
- [blog-instance](_ctx/blog-instance.md) — blog city is always blog/, CITY=blog, consumer repo, sync.js
- [bike-paths](_ctx/bike-paths.md) — how bikepaths.yml (OSM) and markdown cooperate, overlay model, networks

### Guides
- [admin-design-language](_ctx/admin-design-language.md) — utilitarian minimalism (Linear/Notion), function over form
- [stats-philosophy](_ctx/stats-philosophy.md) — "this is liked" not "this performs"; community relationship, not metrics
- [voice-and-feel](_ctx/voice-and-feel.md) — friend showing you around; no exclamation marks, no absolute fitness language
- [brand-framing](_ctx/brand-framing.md) — whereto.bike umbrella, instance types, positioning
- [architecture-principles](_ctx/architecture-principles.md) — Static is Sacred, Develop on a Train, Data Locality, Tags as Behaviour
- [development-principles](_ctx/development-principles.md) — empathy, universality, DDD, durability
- [css-styling](_ctx/css-styling.md) — SCSS variables, dark mode, colocated styles, admin.scss
- [e2e-testing](_ctx/e2e-testing.md) — fixtures, hydration waits, screenshot conventions

### Gotchas
- [platform-gotchas](_ctx/platform-gotchas.md) — Cloudflare fetch deadlock, Rollup dead-code, Preact hydration, CSP
- [preact-islands](_ctx/preact-islands.md) — textarea bug, scoped CSS pitfall, useHydrated, content hash sync
- [astro-cloudflare](_ctx/astro-cloudflare.md) — wrangler config, renderer stripping, cache versioning, import.meta.dirname

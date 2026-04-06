---
description: Wiki/blog/club — feature flags vs identity checks, structural decisions, content pipeline differences
type: knowledge
triggers: [adding instance-specific behaviour, checking instance type, working with content loaders, registering routes or virtual modules]
related: [config-layers, architecture-principles]
---

# Instance Types

Three instance types from one codebase: **wiki** (community route database, default), **blog** (personal ride journal), **club** (randonneuring/event archive). Set via `instance_type` in `{CITY}/config.yml`.

## Feature Flags vs Identity Checks

**Prefer feature flags over identity checks.** Use `getInstanceFeatures()` from `src/lib/config/instance-features.ts` for all feature/capability checks. It returns an `InstanceFeatures` object with semantic boolean flags:

- `hasRides`, `hasEvents`, `allowsRegistration`, `showsLicenseNotice`, etc.

Instead of `if (isBlogInstance())`, write `if (!features.allowsRegistration)` or `if (features.hasRides)`. The flags communicate *why* something is enabled/disabled.

## When to Use Identity Checks

Keep `isBlogInstance()`/`isClubInstance()` **only for structural decisions** — choosing which content loaders, virtual modules, route sets, or admin pages to register. They belong in:

- `src/content.config.ts` — choosing ride vs route loader
- `src/build-data-plugin.ts` — which virtual modules to register
- `src/integrations/i18n-routes.ts` — which route sets to inject
- `src/integrations/admin-routes.ts` — which admin pages to register
- `src/integration.ts` — redirect generation

Everywhere else, use feature flags.

## Content Pipeline Differences

- **Wiki:** Routes loaded via `src/loaders/routes.ts` with directory-based structure, incremental caching, GPX parsing, and locale translations.
- **Blog:** Rides reuse the routes infrastructure — same content collection, same virtual modules, same editor pipeline. The admin-rides loader populates route modules on blog instances. Rides live under `{CITY}/rides/` as GPX files with optional sidecar `.md` and `-media.yml`. Tour grouping from directory structure. Blog city folder is always `blog/`.
- **Club:** Event-focused. Shares routes and places infrastructure but emphasizes events and organisers.

All content types share `GitFileSnapshot`, `GitFiles`, `computeHashFromParts`, and `baseMediaItemSchema` from `src/lib/models/content-model.ts`.

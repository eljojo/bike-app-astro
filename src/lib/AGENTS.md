# Core Library (`src/lib/`)

Service modules, adapters, and utilities organized into domain directories.

## Domain Directories

| Directory | Purpose |
|-----------|---------|
| `auth/` | Authentication (WebAuthn/passkeys), authorization policies, session management, rate limiting, ban service |
| `config/` | Build-time configuration (`CITY`, `CONTENT_DIR`), city config from YAML, instance features, `AppEnv` type |
| `content/` | Content save pipeline (`SaveHandlers<T>`), D1 cache overlay, admin content loading, file serializers, shared `ContentOps` implementations |
| `env/` | Runtime environment resolution — Cloudflare bindings (prod) or local adapters (dev), Astro adapter selection |
| `external/` | Third-party service wrappers: Strava API, email (SES), Google Maps KML, Plausible analytics |
| `geo/` | Geographic calculations: haversine distance, elevation profiles, place/photo proximity, privacy zones |
| `gpx/` | GPX XML parsing, GPX download helpers, waypoint injection into GPX files |
| `git/` | Git operations: GitHub REST API adapter, local git adapter, LFS uploads, GPX commit helper |
| `i18n/` | Locale utilities, URL path segment translations, tag translations, locale switcher |
| `maps/` | MapLibre initialization, style switching, polyline/marker rendering, map thumbnails, static map URLs |
| `markdown/` | Markdown-to-HTML rendering with sanitization, preview text extraction |
| `media/` | Media pipeline: R2/local storage, image dimensions, EXIF extraction, video transcoding, media registry |
| `models/` | Domain model schemas and types — the single source of truth for shared domain schemas |
| `stats/` | Analytics data pipeline: Plausible API sync, engagement scoring, insights, narrative summaries |
| `tile-cache/` | Map tile caching with adapter pattern: KV store (prod) or local filesystem (dev) |

## Model Schemas Are Canonical

Model files in `models/` are the single source of truth for shared domain schemas. Collection schemas in `src/schemas/index.ts` import from model files. Status enums are `as const` arrays in each model file (e.g., `ROUTE_STATUSES`, `EVENT_STATUSES`).

## Vendor Isolation

Platform-specific imports are ONLY allowed in these boundary files:

- `env/env.service.ts` — `cloudflare:workers` (production) or `env.adapter-local.ts` (local)
- `csp-env.ts` — lightweight `cloudflare:workers` reader for CSP (no side effects)
- `env/adapter.ts` — `@astrojs/node` or `@astrojs/cloudflare`
- `git/git-factory.ts` — creates `LocalGitService` or `GitService` based on RUNTIME
- `get-db.ts` — `better-sqlite3` (local) or D1 (production)
- `media/storage.adapter-local.ts` — filesystem bucket for local dev

No other file in the codebase may import platform modules directly.

## Detailed Context

- [Vendor isolation](../../_ctx/vendor-isolation.md)
- [Server boundary convention](../../_ctx/server-boundary.md)
- [Config layers](../../_ctx/config-layers.md)
- [Instance types & feature flags](../../_ctx/instance-types.md)
- [Content model](../../_ctx/content-model.md)

# Core Library (`src/lib/`)

Service modules, adapters, and utilities organized into domain directories. This file is the map — each domain directory has its own AGENTS.md with file-level details and gotchas.

## Domain Directories

| Directory | Purpose |
|-----------|---------|
| `auth/` | Authentication (WebAuthn/passkeys), authorization policies, session management, rate limiting, ban service |
| `config/` | Build-time configuration (`CITY`, `CONTENT_DIR`), city config from YAML, instance features, `AppEnv` type |
| `content/` | Content save pipeline (`SaveHandlers<T>`), D1 cache overlay, admin content loading, file serializers, shared `ContentOps` implementations |
| `env/` | Runtime environment resolution — Cloudflare bindings (prod) or local adapters (dev), Astro adapter selection |
| `external/` | Third-party service wrappers: Strava API, email (SES), Google Maps KML, Plausible analytics |
| `geo/` | Geographic calculations: haversine distance, elevation profiles, place/photo proximity, privacy zones, place data helpers, place category definitions |
| `gpx/` | GPX XML parsing, GPX download helpers, waypoint injection into GPX files |
| `git/` | Git operations: GitHub REST API adapter, local git adapter, LFS uploads, GPX commit helper |
| `i18n/` | Locale utilities, URL path segment translations, tag translations, locale switcher |
| `maps/` | MapLibre initialization, style switching, polyline/marker rendering, map thumbnails, static map URLs, tile proxy helpers |
| `markdown/` | Markdown-to-HTML rendering with sanitization, preview text extraction |
| `media/` | Media pipeline: R2/local storage, image dimensions, EXIF extraction, video transcoding, media registry |
| `tile-cache/` | Map tile caching with adapter pattern: KV store (prod) or local filesystem (dev) |

## Root-Level Files (Utilities)

Files that remain at `src/lib/` root — shared utilities, helpers, and cross-cutting concerns:

- `api-response.ts` — `jsonResponse()`, `jsonError()` helpers for API endpoints
- `csp.ts` — Content Security Policy header construction
- `date-utils.ts` — date formatting and comparison helpers
- `difficulty.ts` — route difficulty scoring
- `fonts.ts` — font preload URLs (build-time transformed)
- `format.ts` — number/unit formatting
- `get-db.ts` — database connection factory (vendor isolation boundary)
- `hooks.ts` — Preact hook utilities
- `json-ld.ts` — structured data for SEO
- `paths.ts` — URL path construction helpers
- `reaction-types.ts` — reaction type definitions
- `redirects.ts`, `slug-redirects.ts`, `tour-redirects.ts` — redirect map builders
- `ride-filters.ts`, `ride-paths.ts` — ride list filtering and path helpers
- `route-data.ts` — route data preparation for views
- `route-insights.ts` — route insight generation
- `route-similarity.ts` — route similarity scoring
- `sitemap.ts` — sitemap XML generation
- `slug.ts`, `clean-slug-name.ts` — slug sanitization
- `toast.ts` — client-side toast notifications
- `username.ts` — username sanitization

## Vendor Isolation

Platform-specific imports are ONLY allowed in these boundary files:

- `env/env.service.ts` — `cloudflare:workers` (production) or `env.adapter-local.ts` (local)
- `csp-env.ts` — lightweight `cloudflare:workers` reader for CSP (no side effects)
- `env/adapter.ts` — `@astrojs/node` or `@astrojs/cloudflare`
- `git/git-factory.ts` — creates `LocalGitService` or `GitService` based on RUNTIME
- `get-db.ts` — `better-sqlite3` (local) or D1 (production)
- `media/storage.adapter-local.ts` — filesystem bucket for local dev

No other file in the codebase may import platform modules directly.

## Fail Loud on Missing Configuration

Never silently fall back when required env vars or config values are missing. A missing value that produces `undefined` instead of an error leads to silently broken behaviour — CSP directives that omit origins, API calls that go nowhere, features that quietly degrade. Use explicit checks that throw with a clear message naming the missing value and where to set it (like Ruby's `Hash#fetch`). See `requireEnv()` in `csp-env.ts` for the pattern.

The only acceptable silent fallback is during Astro prerendering, where runtime env (Cloudflare bindings) is genuinely unavailable. Guard those paths with an explicit `null` return and a comment explaining why.

## Build-Time Transforms

Three files use `fs.readFileSync` in Node.js but get **completely replaced** during the Vite build by `src/build-data-plugin.ts`:

- `config/city-config.ts` — replaced with static JSON from config.yml
- `i18n/tag-translations.server.ts` — replaced with static translation map
- `fonts.server.ts` — replaced with static font preload URLs

If you change the exports of these files, you MUST also update the transform in `build-data-plugin.ts`.

## Config Layers — Don't Confuse Them

- **Build-time** (`config/config.ts` + `config/config.server.ts`): `config.ts` exports `CITY` and `VIDEO_PREFIX` (browser-safe). `config.server.ts` exports `CONTENT_DIR` and `cityDir` (uses `node:path`, server-only).
- **Runtime** (`env/env.service.ts`): reads Cloudflare bindings or local env at request time. `GITHUB_TOKEN`, `GIT_OWNER`, `GIT_DATA_REPO`, `DB`, `BUCKET`, etc. via `AppEnv`.

## Key Function Signatures

- `authorize()` in `auth/authorize.ts` returns `SessionUser | Response` (401/403) — NOT a boolean. For boolean UI-level checks, use `can()`.
- `withBatch()` in `db/transaction.ts` collects unawaited query builders. Do NOT await inside the callback — it executes prematurely instead of batching.

## Instance Feature Flags

Use `getInstanceFeatures()` from `config/instance-features.ts` for all feature/capability checks. It returns an `InstanceFeatures` object with semantic boolean flags like `hasRides`, `hasEvents`, `allowsRegistration`, `showsLicenseNotice`.

**Prefer feature flags over identity checks.** Instead of `if (isBlogInstance())`, write `if (!features.allowsRegistration)` or `if (features.hasRides)`. The flags communicate *why* something is enabled/disabled.

**Keep `isBlogInstance()`/`isClubInstance()` only for structural decisions** — choosing which content loaders, virtual modules, route sets, or admin pages to register. They live in:
- `content.config.ts` — choosing ride vs route loader
- `build-data-plugin.ts` — which virtual modules to register
- `integrations/i18n-routes.ts` — which route sets to inject
- `integrations/admin-routes.ts` — which admin pages to register
- `integration.ts` — redirect generation

## Server Boundary Convention

See root AGENTS.md § Server Boundary Convention for the `.server.ts` naming convention and ESLint enforcement.

## CSP

When adding external domains or inline scripts, update `csp.ts`. For SSR pages, use `is:inline nonce={cspNonce}`. For static pages (prerender=true), use bare `<script>` tags — Astro hashes them. Never use `is:inline` on static pages.

### CSP Upload Origins

Upload origins (R2, S3) for `connect-src` are read at request time by `csp-env.ts`, NOT by `env.ts`. This is because `env.ts` has top-level await that silently kills Astro's prerender step when imported from middleware. `csp-env.ts` is a separate lightweight wrapper — no top-level side effects, lazy `cloudflare:workers` import inside the function body only.

`R2_ACCOUNT_ID` is required and will throw if missing at request time. `S3_ORIGINALS_BUCKET` and `MEDIACONVERT_REGION` are optional (only needed for video support).

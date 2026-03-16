# Architecture Reference

Technical reference for the codebase. For principles and behavioral rules, see the root `AGENTS.md`.

## Instance Types

Three instance types from one codebase: **wiki** (community route database, default), **blog** (personal ride journal), **club** (randonneuring/event archive). Set via `instance_type` in `{CITY}/config.yml`.

Use `getInstanceFeatures()` for capability checks. Reserve `isBlogInstance()`/`isClubInstance()` for structural decisions (loaders, virtual modules, route sets). See `src/lib/AGENTS.md`.

Rides reuse the routes infrastructure — same content collection, same virtual modules, same editor pipeline. The admin-rides loader populates route modules on blog instances.

All content types share `GitFileSnapshot`, `GitFiles`, `computeHashFromParts`, and `baseMediaItemSchema` from `src/lib/models/content-model.ts`.

## Content Pipeline

Content lives in a separate data repo (`~/code/bike-routes`), loaded via Astro content collections. `CONTENT_DIR` points to it, `CITY` selects which city. City config: `{CONTENT_DIR}/{CITY}/config.yml`.

Collections: `routes`, `places`, `guides`, `events`, `organizers`, `pages` — defined in `src/content.config.ts`. Translation files (`*.??.md`) excluded from base loading.

Routes use a custom loader (`src/loaders/routes.ts`) with directory-based structure, incremental caching, GPX parsing, and locale translations.

Rides (blog) live under `{CITY}/rides/` as GPX files with optional sidecar `.md` and `-media.yml`. Tour grouping from directory structure.

## Configuration Layers

Two distinct layers — don't confuse them:

- **Build-time** (`src/lib/config/config.ts`): reads `process.env` at module evaluation. `CONTENT_DIR`, `CITY`, `cityDir`, `SITE_URL`, `VIDEO_PREFIX`.
- **Runtime** (`src/lib/env/env.service.ts`): reads Cloudflare bindings or local env at request time. `GITHUB_TOKEN`, `DB`, `BUCKET`, `GIT_OWNER`, `GIT_DATA_REPO`, etc. via `AppEnv`.

City config from `{cityDir}/config.yml` defines: display name, CDN URLs, tile server, timezone, locales, map bounds, place categories, analytics domain, author info. Locales derived from city config, not hardcoded.

## Adapter Boundary Points

The local-vs-production switch (`RUNTIME=local`) is checked at six isolation boundaries:

| Boundary | Local | Production |
|----------|-------|------------|
| `src/lib/env/env.service.ts` | `env.adapter-local.ts` | `cloudflare:workers` |
| `src/lib/env/adapter.ts` | `@astrojs/node` | `@astrojs/cloudflare` |
| `src/lib/git/git-factory.ts` | `LocalGitService` (simple-git) | `GitService` (GitHub API) |
| `src/lib/get-db.ts` | Fresh `better-sqlite3` per call | `getD1Db(env.DB)` (D1) |
| `src/lib/media/storage.adapter-local.ts` | Filesystem (`.data/uploads/`) | R2 bucket |
| `src/lib/tile-cache/tile-cache.ts` | Filesystem (`.data/tile-cache/`) | Workers KV |

## Virtual Module System

Vite plugin in `src/build-data-plugin.ts` provides 13+ virtual modules:

- **Admin content** (via `registerAdminModules`, strips trailing `s` for detail names): `admin-routes`/`admin-route-detail`, `admin-events`/`admin-event-detail`, `admin-places`/`admin-place-detail`, `admin-organizers`
- **Photo/media indexes**: `photo-locations`, `nearby-photos`, `parked-photos`, `photo-shared-keys`
- **Other**: `cached-maps`, `contributors`

Types: `src/virtual-modules.d.ts` (ambient — NO imports!) and `src/virtual.d.ts` (`cached-maps`).

`vitest.config.ts` includes the plugin so virtual modules resolve in tests.

## Cache-Overlay Pattern

Admin pages use two-tier data loading (`src/lib/content/load-admin-content.ts`):

1. **D1 `content_edits` table** — updated after every save
2. **Virtual module data** — build-time snapshots, fallback when no cache entry exists

Adding a new field requires updating both the schema and the cache parser.

## Save Pipeline

Editor → `POST /api/{content-type}/{slug}` → `content-save.ts` orchestrator → `SaveHandlers<T>` → git commit → D1 cache update.

See `src/views/api/AGENTS.md` for detailed gotchas. Key behaviors: conflict detection via blob SHAs, permission stripping for non-admins, `afterCommit` for photo registry updates.

## Admin, i18n, Database

- **Admin**: public pages static, admin/API server-rendered. Auth via WebAuthn passkeys, three roles. See `src/components/admin/AGENTS.md`.
- **i18n**: three layers — UI strings via `t()`, URL path translations, content sidecar files. See `src/integrations/AGENTS.md`.
- **Database**: Drizzle ORM on SQLite (D1 prod, better-sqlite3 local). Schema: `src/db/schema.ts`, migrations: `drizzle/migrations/`.

## Other Subsystems

- **Media URLs**: R2 via `R2_PUBLIC_URL`, images use `cdn-cgi/image/{transforms}/{blobKey}`, videos direct.
- **Reactions**: ridden/thumbs-up/star on routes and events, excluded from auth middleware.
- **Contributors**: `scripts/build-contributors.ts` → `.astro/contributors.json` — must run BEFORE `astro build`.

## Key Directories

```
src/
  components/     # .astro components + admin Preact islands (src/components/admin/)
  db/             # Drizzle schema, migrations init, transaction helper
  i18n/           # Locale JSON files (en.json, fr.json, es.json) + t() helper
  integrations/   # Astro integrations (route injection, i18n, build plugins)
  layouts/        # Base.astro (shell with header, nav, footer)
  lib/            # Core library — 12 domain directories + shared utilities
    auth/         # WebAuthn sessions, authorization, rate limiting, bans, pseudonyms
    config/       # Build-time config, city config, instance features, AppEnv type
    content/      # Save pipeline, D1 cache, admin content loading, file serializers
    env/          # Runtime environment (Cloudflare/local adapter), Astro adapter
    external/     # Third-party integrations (Strava, email, Google Maps, analytics)
    geo/          # Distance, elevation, proximity, privacy zones, photo geolocation
    git/          # Git operations (GitHub API, local git, LFS, GPX commit helper)
    i18n/         # Locale utilities, URL path translations, tag translations
    maps/         # Map initialization, style management, thumbnails, path geometry
    markdown/     # Markdown rendering and preview text extraction
    media/        # Storage, images, video, transcoding, EXIF, photo registry
    models/       # Canonical type defs: content-model.ts (shared base), route/ride/event/place models
    tile-cache/   # Map tile caching (KV store / local filesystem adapters)
  loaders/        # Custom Astro content loaders (routes, pages, admin data)
  schemas/        # Zod schemas for content collections (barrel export via index.ts)
  styles/         # SCSS — _variables.scss is the design token source of truth
  types/          # TypeScript types (admin.ts, mapbox-polyline.d.ts)
  views/          # All pages + API endpoints (injected via injectRoute, no src/pages/)
docs/             # Documentation site (separate npm workspace)
drizzle/          # Migration SQL files
e2e/              # Playwright screenshot + admin E2E tests
public/           # Static assets (maps/, favicons)
scripts/          # Build-time scripts (maps, fonts, validation, contributors)
tests/            # Vitest unit tests (129 test files)
.data/            # Local dev data (e2e-content/, local.db, uploads/)
```

`tsconfig.json` defines `@/*` → `src/*` path alias. JSX configured for Preact.

## CI/CD

Workflows live in `.github/workflows/`. Key files:

- **`ci.yml`** — Runs on PRs to `main`. Lint, typecheck, unit tests, E2E tests, then builds and deploys Ottawa staging + demo + brevet production. Screenshot baselines auto-updated and committed.
- **`production.yml`** — Runs on push to `main` or data repo webhook (`data-updated`). Matrix deploys Ottawa, demo, brevet. Smart city detection: data webhooks rebuild only the affected city. Also deploys video agent Lambda on code changes.
- **`staging.yml`** — Manual dispatch or data repo webhook (`staging-data-updated`). Builds Ottawa with `data-ref: staging`.
- **`_build-city.yml`** — Reusable workflow called by all the above. Inputs: `city`, `wrangler-env`, `deploy`, `run-migrations`, `data-ref`, etc. Handles: checkout, map generation, contributor stats, `astro build`, wrangler config patching, D1 migrations, Cloudflare deploy, stale cache cleanup.
- **`_test.yml`** — Reusable test workflow. Runs unit + all E2E suites (public, admin, blog, club). Auto-commits updated screenshot baselines on PRs.

**Staging deploy flow:** PR to `main` → `ci.yml` → `deploy-ottawa-staging` job → calls `_build-city.yml` with `wrangler-env: staging`, `data-ref: staging`, `run-migrations: true`.

**Build-time env vars in CI:** `_build-city.yml` resolves `VIDEO_PREFIX` from `wrangler.jsonc` env vars (via `sed` + `jq`) and passes it to `astro build`. If this resolution fails, the build silently uses `CITY` as fallback — video key annotation will break without error.

**Screenshot auto-update:** `_test.yml` runs Playwright with `--update-snapshots`, commits diffs, and posts a PR comment listing affected snapshots. Only runs for PR authors with push access (blocks forks).

**Caching:** LFS (2-week rolling), map thumbnails (keyed on GPX hashes), Astro content cache (keyed on city content hash), Playwright browsers (keyed on lockfile).

---

## Adding New Things — Checklists

### Adding a New Content Type (Admin-Editable)

1. `src/schemas/index.ts` — add Zod schema
2. `src/content.config.ts` — add collection with loader and base path
3. `src/lib/models/{type}-model.ts` — detail type, Zod validation, `fromGit()`, `fromCache()`, `buildFreshData()`, `computeContentHash()`
4. `src/loaders/admin-{type}s.ts` — admin data loader returning `{list, details}`
5. `src/build-data-plugin.ts` — register with `registerAdminModules({name: '{type}s', ...})`. Detail module strips trailing `s`.
6. `src/lib/content/content-types.ts` — add to content type registry (routing, UI metadata, admin nav)
7. `src/virtual-modules.d.ts` — ambient type declarations (NO top-level imports)
8. `src/types/admin.ts` — add `Admin{Type}` interface for list view
9. `src/views/api/{type}-save.ts` — implement `SaveHandlers<T>` with `POST` export
10. `src/integrations/admin-routes.ts` — register admin pages + API endpoint
11. `src/views/admin/{type}-detail.astro` + `{type}-new.astro` — admin pages
12. `src/views/admin/{types}.astro` — admin list page
13. `src/components/admin/{Type}Editor.tsx` — Preact island
14. `src/styles/admin.scss` — all editor styles (NOT scoped `<style>`)
15. `src/lib/content/load-admin-content.ts` — add list overlay function if needed

All content data serialization/deserialization MUST go through model files. Never hand-roll `JSON.stringify`/`JSON.parse` for content types.

### Adding a New API Endpoint

1. Create file in `src/views/api/` (auth endpoints in `src/views/api/auth/`)
2. Add `export const prerender = false`
3. Add `authorize(user, action)` call — EVERY endpoint needs this (ESLint enforces it)
4. Register in `src/integrations/admin-routes.ts` (static routes before parameterized)
5. If public, add exclusion in `src/middleware.ts` `isProtected` check
6. If new permission needed, add action to `src/lib/auth/authorize.ts`

### Adding a New i18n Route

1. Add entry to `localePages` in `src/integrations/i18n-routes.ts`
2. Add URL segment translation to `src/lib/i18n/path-translations.ts`
3. Add UI strings to `src/i18n/{en,fr,es}.json`
4. Create view file in `src/views/`

### Adding a New Database Table

1. Add Drizzle table in `src/db/schema.ts`
2. Run `npx drizzle-kit generate`
3. `init-schema.ts` picks it up for local dev
4. `wrangler.jsonc` `migrations_dir` ensures D1 gets it on deploy

### Adding a New Virtual Module

1. Add `resolveId` + `load` in `src/build-data-plugin.ts`
2. Add ambient type declaration in `src/virtual-modules.d.ts` (NO imports)
3. Tests work because `vitest.config.ts` includes the plugin

### Adding a New Preact Island

1. Create `.tsx` in `src/components/admin/`
2. ALL styles go in `src/styles/admin.scss`
3. Render with `client:load` or `client:visible`
4. Ensure virtual module imports are declared in `virtual-modules.d.ts`

## Gotchas

Additional gotchas not covered by directory-level files:

- **Prerender flags**: every page/API endpoint MUST export `prerender` (true or false).
- **Virtual module types**: `src/virtual-modules.d.ts` is ambient — NO top-level imports.
- **Path resolution**: never use `path.resolve('relative/path')` — use `import.meta.dirname`.
- **No client-side navigation**: full page loads, no `<ClientRouter />`. Use `DOMContentLoaded`, not `astro:page-load`.
- **Middleware exclusions**: `/api/auth/*` and `/api/reactions/*` skip auth.
- **Wrangler config**: no `main` field in source `wrangler.jsonc` — CI patches it post-build.
- **Map markers**: never use default MapLibre markers — use CSS-styled HTML markers.
- **Zod v4**: import from `astro/zod`, not `zod`. Use `z.record(z.string(), z.unknown())`, `z.looseObject()`.

### Incremental Builds

Two layers: persistent content cache (`.astro/cache/admin-{rides,routes}-cache.json`) and build plan (`.astro/cache/build-plan.json`). Safe by default — new pages always rebuild. Only pages calling `filterByBuildPlan()` get incremental filtering.

Full build triggers: code changes, package updates, no previous manifest, >50% content changed, `FORCE_FULL_BUILD=1`.

If you change the shape of `AdminRide`, `AdminRideDetail`, `AdminRoute`, or `RouteDetail`, bump `RIDE_CACHE_VERSION` or `ROUTE_CACHE_VERSION` in the corresponding admin loader.

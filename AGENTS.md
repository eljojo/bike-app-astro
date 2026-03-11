# Ottawa by Bike — Astro Rebuild

Static site rebuild of [ottawabybike.ca](https://ottawabybike.ca). Part of the **whereto.bike** platform — a global, open-source cycling wiki with city-specific instances. `CLAUDE.md` is a symlink to this file (`AGENTS.md`).

## Site Goals

1. **Increase the number of first-time bicycle riders.**
2. **Tap into experienced riders to help achieve goal 1.**

These are the lens for all product and messaging decisions.

## Brand & Product Framing

- **whereto.bike** — Global cycling wiki platform (umbrella brand, AGPL)
- **ottawabybike.ca** — Ottawa instance, established local brand (est. 2022), "powered by whereto.bike"
- **{city}.whereto.bike** — Future city subdomains
- **Show, don't tell.** Real photos, real humans, real routes. No pitching.
- **Rider first, contributor second.** Lead with utility (find a ride), not contribution (add a GPX).
- **Quiet confidence.** No ads, no algorithms, no paywalls — communicated through absence, not promises. Never sound like a startup.
- **Don't name competitors.** Let the product speak for itself.
- **Human over algorithmic.** Every photo was taken by someone who was there. Every route was ridden by a real person.
- **Inclusive and empathetic.** Never use absolute fitness language ("easy", "hard") — use relative framing ("easier than most routes on this site").

## Quick Start

```sh
nix develop        # enter dev shell (node 22, vips, playwright)
make install       # npm install
make dev           # astro dev server on localhost:4321
```

Run `make` to see all available targets.

**IMPORTANT:** All commands (`make`, `npm`, `npx`, etc.) MUST be run inside `nix develop`. Either enter the shell interactively or prefix commands: `nix develop --command bash -c "make build"`.

---

## Mandatory Rules

### No Bracket Filenames

NEVER create files with `[` or `]` in their names (e.g. `[slug].astro`, `[id].ts`). Astro's file-based routing convention of bracket filenames is forbidden in this project.

Dynamic routes are registered via `injectRoute()` in Astro integrations. View files live in `src/views/` with plain names. See `src/integrations/i18n-routes.ts` for public routes and `src/integrations/admin-routes.ts` for admin/API routes.

### Vendor Isolation

NEVER import platform-specific modules (e.g. `cloudflare:workers`, AWS SDK, Vercel helpers) directly in application code. All platform APIs must be accessed through a single wrapper file in `src/lib/`. Application code imports from OUR modules only. One wrapper file per vendor concern — if they rename or break their API, only one file changes. No exceptions.

### Don't Shrug Off Broken Things

If something fails — a build, a tool, a command — investigate it. Don't dismiss it as "pre-existing" or "not my problem" and move on. A broken build that you work around is a broken build you'll ship against. Diagnose it, fix it or raise it. Never normalize broken infrastructure.

### Never Hardcode City/Locale Values

NEVER write string literals like `'ottawa'` or `'fr'` in application code. Always import `CITY` from `src/lib/config.ts`. Check city config for available locales. The codebase supports multiple cities via the `CITY` env var.

---

## Gotchas

Gotchas are documented in directory-level AGENTS.md files, next to the code they apply to:

- **Save pipeline** (frontmatter merge, content hash, blob SHA): `src/views/api/AGENTS.md`
- **Preact islands** (textarea hydration, scoped CSS, state sync): `src/components/admin/AGENTS.md`
- **Styling** (dark mode, SCSS compiler, admin.scss): `src/styles/AGENTS.md`
- **Core library** (build-time transforms, vendor isolation, config layers, CSP, authorize): `src/lib/AGENTS.md`
- **Integrations** (route ordering, bracket filenames, i18n sync): `src/integrations/AGENTS.md`
- **E2E tests** (fixture dates, DB lifecycle, generated files): `e2e/AGENTS.md`

Hotspot files also have header comments pointing to their directory's AGENTS.md.

Additional gotchas not covered by directory files:

- **Prerender flags**: every page/API endpoint MUST export `prerender` (true or false).
- **Virtual module types**: `src/virtual-modules.d.ts` is ambient — NO top-level imports or it breaks all declarations.
- **Path resolution**: never use `path.resolve('relative/path')` — use `import.meta.dirname`.
- **View Transitions**: use `astro:page-load` event, not `DOMContentLoaded`.
- **Middleware exclusions**: `/api/auth/*` and `/api/reactions/*` skip auth — don't put protected endpoints there.
- **Wrangler config**: never add `main` field — it breaks builds.
- **Map markers**: never use default MapLibre markers — use CSS-styled HTML markers.
- **Zod v4**: import from `astro/zod`, not `zod`. Use `z.record(z.string(), z.unknown())`, `z.looseObject()`.

---

## Architecture

### Content Pipeline

Content lives in a separate data repo (`~/code/bike-routes`) and is loaded via Astro content collections. The `CONTENT_DIR` env var points to it (defaults to `../bike-routes`). The `CITY` env var (defaults to `ottawa`) selects which city's data to load. City config is read from `{CONTENT_DIR}/{CITY}/config.yml`.

Collections: `routes`, `places`, `guides`, `events`, `organizers`, `pages` — defined in `src/content.config.ts`. Translation files (`*.??.md`) are excluded from base loading and handled separately.

Routes are special — they use a custom loader (`src/loaders/routes.ts`) that:
- Parses directory-based structure (`routes/{slug}/` with `index.md`, `media.yml`, `variants/`, GPX files)
- Implements incremental caching via MD5 digest of file mtimes
- Parses GPX XML and renders markdown at load time
- Loads locale translations from sidecar files

Pages use a custom loader (`src/loaders/pages.ts`). Other collections use Astro's `glob` loader.

### Data Locality Principle

Data lives next to what uses it. Route photos live in the route's `media.yml`. Place photos live in the place's frontmatter. This colocation is a core architectural choice — never centralize data that belongs to a specific content item. City-level files (like `parked-photos.yml`) exist only for data with no content item to live next to.

When building query layers over distributed data, the index is a **computed view** — never the canonical store.

### Configuration Layers

Two distinct config layers — don't confuse them:

- **Build-time** (`src/lib/config.ts`): reads `process.env` at module evaluation. Exports `CONTENT_DIR`, `CITY`, `cityDir`, `SITE_URL`, `CONTACT_EMAIL`, `CDN_FALLBACK_URL`.
- **Runtime** (`src/lib/env.ts`): reads Cloudflare bindings or local env at request time. Provides `GITHUB_TOKEN`, `DB`, `BUCKET`, `GIT_OWNER`, `GIT_DATA_REPO`, etc. via the `AppEnv` interface (`src/lib/app-env.ts`).

City-specific config is loaded from `{cityDir}/config.yml` by `src/lib/city-config.ts` and defines: display name, CDN URLs, tile server, timezone, locales, map bounds, place categories, analytics domain, and author info. Locales are derived from the city config (e.g., `[en-CA, fr-CA]` → `[en, fr]`), not hardcoded.

### Five Adapter Boundary Points

The local-vs-production switch (`RUNTIME=local`) is checked at five isolation boundaries:

| Boundary | Local | Production |
|----------|-------|------------|
| `src/lib/env.ts` | `env-local.ts` (imports `db/local.ts`, triggers DB init) | `cloudflare:workers` |
| `src/lib/adapter.ts` | `@astrojs/node` standalone | `@astrojs/cloudflare` |
| `src/lib/git-factory.ts` | `LocalGitService` (simple-git, module-level write mutex) | `GitService` (GitHub REST API, LFS for GPX) |
| `src/lib/get-db.ts` | **Fresh** `better-sqlite3` connection per call (not singleton — required for cross-process Playwright visibility) | `getD1Db(env.DB)` wrapping D1 |
| `src/lib/storage-local.ts` | Filesystem-backed bucket (`.data/uploads/`) | R2 bucket |

`astro.config.mjs` marks `cloudflare:workers` as external when `RUNTIME=local` to prevent Rollup resolution errors.

### Virtual Module System

The Vite plugin in `src/build-data-plugin.ts` provides 13+ virtual modules with build-time data:

**Admin content** (via `registerAdminModules`, which strips trailing `s` for detail module names):
- `virtual:bike-app/admin-routes` / `admin-route-detail`
- `virtual:bike-app/admin-events` / `admin-event-detail`
- `virtual:bike-app/admin-places` / `admin-place-detail`
- `virtual:bike-app/admin-organizers`

**Photo/media indexes:**
- `virtual:bike-app/photo-locations` — geolocated photos from routes + parked photos
- `virtual:bike-app/nearby-photos` — pre-computed nearby photos per route
- `virtual:bike-app/parked-photos` — city-level `parked-photos.yml`
- `virtual:bike-app/photo-shared-keys` — cross-references photo keys across content types

**Other:**
- `virtual:bike-app/cached-maps` — scans `public/maps/` for thumbnails
- `virtual:bike-app/contributors` — reads `.astro/contributors.json`

Type declarations: `src/virtual-modules.d.ts` (most modules, ambient file — no imports!) and `src/virtual.d.ts` (`cached-maps` only).

`vitest.config.ts` includes `buildDataPlugin()` so virtual modules resolve in unit tests. Tests that transitively import virtual modules will fail if the content directory is missing.

### Cache-Overlay Pattern

Admin pages use a two-tier data loading pattern (`src/lib/load-admin-content.ts`):

1. **D1 `content_edits` table** — updated after every save, contains latest content including items created since last deploy
2. **Virtual module data** — build-time snapshots, the fallback when no cache entry exists

The list overlay merges build-time data with cache entries and appends cache-only items (created post-deploy). The `fromCache` parameter uses a Zod schema parser — if cached JSON doesn't validate, it silently falls back to virtual module data. Adding a new field to a model requires updating both the schema and the cache parser.

### Save Pipeline

Editor → `POST /api/{content-type}/{slug}` → `content-save.ts` orchestrator → content-type `SaveHandlers<T>` → git commit → D1 cache update.

The `SaveHandlers<T, R>` interface (`src/lib/content-save.ts`) has 10 methods: `parseRequest`, `resolveContentId`, `validateSlug?`, `getFilePaths`, `computeContentHash`, `buildFreshData`, `checkExistence?`, `buildFileChanges`, `buildCommitMessage`, `buildGitHubUrl`, `afterCommit?`.

Implementations: `src/views/api/route-save.ts`, `src/views/api/event-save.ts`, `src/views/api/place-save.ts`.

Key behaviors:
- **Conflict detection**: compare-and-swap using blob SHAs in D1 cache
- **Permission stripping**: non-admin users have `status` stripped; non-editors have `newSlug` stripped
- **`afterCommit`**: updates photo-shared-keys registry; failures are logged but don't fail the response
- Deploy cleanup uses `WHERE updated_at < $BUILD_START` to avoid losing concurrent edits

### Admin Architecture

Hybrid mode: public pages are static (`prerender = true`), admin/API pages are server-rendered (`prerender = false`). Auth via WebAuthn (passkeys), three roles: `admin`, `editor`, `guest`. See `src/components/admin/AGENTS.md` for Preact island patterns.

### i18n — Three Layers

Locales driven by city config. Layer 1: UI strings via `t()`. Layer 2: URL path segment translations (`src/lib/path-translations.ts`). Layer 3: content sidecar files (`index.fr.md`). See `src/integrations/AGENTS.md` for sync requirements.

### Database

Drizzle ORM on SQLite (D1 in production, `better-sqlite3` locally). Schema: `src/db/schema.ts`, migrations: `drizzle/migrations/`. `init-schema.ts` applies migrations idempotently.

### Other Subsystems

- **Media URLs**: R2 via `R2_PUBLIC_URL`, images use `cdn-cgi/image/{transforms}/{blobKey}`, videos direct.
- **Reactions**: ridden/thumbs-up/star on routes and events, excluded from auth middleware.
- **Contributors**: `scripts/build-contributors.ts` generates `.astro/contributors.json` — must run BEFORE `astro build`.

### Key Directories

```
src/
  components/     # .astro components + admin Preact islands (src/components/admin/)
  db/             # Drizzle schema, migrations init, transaction helper
  i18n/           # Locale JSON files (en.json, fr.json, es.json) + t() helper
  integrations/   # Astro integrations (route injection, i18n, build plugins)
  layouts/        # Base.astro (shell with header, nav, footer)
  lib/            # Service modules, adapters, save pipeline, auth
  lib/models/     # Canonical type defs: route-model.ts, event-model.ts, place-model.ts
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
tests/            # Vitest unit tests (75+ test files)
.data/            # Local dev data (e2e-content/, local.db, uploads/)
```

`tsconfig.json` defines `@/*` → `src/*` path alias. JSX is configured for Preact (`jsxImportSource: preact`).

---

## Adding New Things — Checklists

### Adding a New Content Type (Admin-Editable)

This is the most complex operation. Files that must change together:

1. `src/schemas/index.ts` — add Zod schema
2. `src/content.config.ts` — add collection with loader and base path
3. `src/lib/models/{type}-model.ts` — detail type, Zod validation, `fromGit()`, `fromCache()`, `buildFreshData()`, `computeContentHash()`
4. `src/loaders/admin-{type}s.ts` — admin data loader returning `{list, details}`
5. `src/build-data-plugin.ts` — import loader, register with `registerAdminModules({name: '{type}s', ...})`. NOTE: detail module name strips trailing `s` (`places` → `admin-place-detail`)
6. `src/virtual-modules.d.ts` — add ambient type declarations (NO top-level imports)
7. `src/types/admin.ts` — add `Admin{Type}` interface for list view
8. `src/views/api/{type}-save.ts` — implement `SaveHandlers<T>` with `POST` export
9. `src/integrations/admin-routes.ts` — register admin pages + API endpoint
10. `src/views/admin/{type}-detail.astro` + `{type}-new.astro` — admin pages
11. `src/views/admin/{types}.astro` — admin list page
12. `src/components/admin/{Type}Editor.tsx` — Preact island
13. `src/styles/admin.scss` — all editor styles (NOT scoped `<style>`)
14. `src/lib/load-admin-content.ts` — add list overlay function if needed

### Adding a New API Endpoint

1. Create file in `src/views/api/` (auth endpoints go in `src/views/api/auth/`)
2. Add `export const prerender = false`
3. Register in `src/integrations/admin-routes.ts` (static routes before parameterized)
4. If public (no auth needed), add exclusion in `src/middleware.ts` `isProtected` check
5. If new permission needed, add action to `src/lib/authorize.ts`

### Adding a New i18n Route

1. Add entry to `localePages` in `src/integrations/i18n-routes.ts`
2. Add URL segment translation to `src/lib/path-translations.ts` `segmentTranslations`
3. Add UI strings to `src/i18n/{en,fr,es}.json`
4. Create view file in `src/views/` (same file serves all locales)

### Adding a New Database Table

1. Add Drizzle table in `src/db/schema.ts`
2. Run `npx drizzle-kit generate` to create migration SQL in `drizzle/migrations/`
3. `init-schema.ts` picks it up automatically for local dev
4. `wrangler.jsonc` `migrations_dir` ensures D1 gets it on deploy

### Adding a New Virtual Module

1. Add `resolveId` + `load` in `src/build-data-plugin.ts`
2. Add ambient type declaration in `src/virtual-modules.d.ts` (NO imports in that file)
3. Tests importing it transitively will work because `vitest.config.ts` includes the plugin

### Adding a New Preact Island

1. Create `.tsx` in `src/components/admin/`
2. ALL styles go in `src/styles/admin.scss` (scoped CSS won't reach it)
3. Render in host `.astro` page with `client:load` or `client:visible`
4. If importing virtual modules, ensure they're declared in `virtual-modules.d.ts`

---

## CSS & Styling

See `src/styles/AGENTS.md` for styling rules. Key: use SCSS variables from `_variables.scss`, dark mode needs both variants, Preact island styles go in `admin.scss` only.

## Testing

```sh
make test          # vitest unit tests (tests/)
make test-e2e      # build (CITY=demo) + playwright screenshot tests
make test-admin    # admin E2E tests (save flow, community editing, etc.)
make full          # build + validate + unit + all E2E
```

Screenshot tests build against `CITY=demo` (a fixture city), not Ottawa. See `e2e/AGENTS.md` for fixture system details.

## Build

```sh
make build         # astro build → dist/
make maps          # generate map thumbnail cache (public/maps/)
make validate      # validate content data
make contributors  # build contributor stats (must run BEFORE astro build)
make fonts         # download and embed Google Fonts
```

**Build order matters:** `make contributors` and `make maps` must run before `astro build` because they generate files consumed by virtual modules.

Build integrations in `astro.config.mjs`: `copy-map-cache`, `generate-redirects`, `patch-static-csp-style-src`. See `src/lib/AGENTS.md` for CSP details.

## Git Conventions

- Never add `Co-Authored-By` lines to commits
- Do not auto-commit — wait for explicit instructions
- PNGs are tracked with Git LFS

## Related Repos

- `~/code/bike-app` — Rails app (production source of truth for CSS matching). Plans/design docs go in `~/code/bike-app/docs/plans/`
- `~/code/bike-routes` — Content data repo (routes, guides, events, places)
- `~/code/bike-routes-golden-tests` — Golden test artifacts (production screenshots)

## Environment Variables

See `.env.example` for the full list. Key variables: `RUNTIME=local` for offline dev, `CONTENT_DIR` for data repo path, `CITY` for city selection (default: `ottawa`, E2E: `demo`).

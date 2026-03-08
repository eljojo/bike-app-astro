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

## Gotchas — Read Before Writing Code

These are patterns that have caused repeated bugs. Each has been learned the hard way through multiple fix commits.

### Prerender Flags Are Required

Every page and API endpoint MUST have an explicit `export const prerender = true` or `export const prerender = false`. Public pages are `true` (static). Admin pages, auth pages, and API endpoints are `false` (server-rendered). Getting this wrong means either a static page that can't access runtime data or unnecessary server compute.

### Build-Time Transforms

Three files use `fs.readFileSync` in Node.js but get **completely replaced** during the Vite build by `src/build-data-plugin.ts`:

- `src/lib/city-config.ts` — replaced with static JSON from `config.yml`
- `src/lib/tag-translations.ts` — replaced with static translation map
- `src/lib/fonts.ts` — replaced with static font preload URLs

This exists because Cloudflare workerd cannot access the host filesystem. If you modify the exports of these files, you MUST also update the corresponding transform code in `build-data-plugin.ts`. The transform generates a completely new module body — it does not wrap the original.

### Virtual Module Type Declarations

`src/virtual-modules.d.ts` is an **ambient declaration file** — it MUST NOT have any top-level imports or exports. Adding an `import` at the top converts it to a module augmentation file and breaks ALL virtual module type declarations. Use private interfaces (prefixed with `_`) defined inline for complex types.

`src/virtual.d.ts` is a separate file that only declares `virtual:bike-app/cached-maps`.

### Preact Island Styles — No Scoped CSS

Astro's scoped `<style>` blocks do NOT reach Preact islands (they're hydrated independently). ALL styling for admin Preact components must go in `src/styles/admin.scss` as global rules. This is the most common source of "styles work in Astro but not in the Preact component" bugs.

### Preact Textarea Hydration Bug

Preact has a known hydration issue with `<textarea>` elements. When SSR renders text inside a textarea, `hydrate()` skips applying the `value` prop, then child diffing removes the SSR content, leaving the field empty. Every textarea in a Preact island needs this workaround:

```tsx
const bodyRef = useRef<HTMLTextAreaElement>(null);
useEffect(() => {
  if (bodyRef.current && body && !bodyRef.current.value) {
    bodyRef.current.value = body;
  }
}, []);
```

### Save Pipeline — Always Merge Frontmatter

When building save handlers, ALWAYS read existing frontmatter first and merge editor changes on top. Never reconstruct frontmatter from only the fields the UI sends — this silently deletes fields the editor doesn't know about (variants, created_at, strava_url, etc.):

```typescript
const existing = matter(currentFile.content).data;
const merged = { ...existing, ...editorFields };
```

### Content Hash — Compare-and-Swap

The save pipeline uses optimistic concurrency control. After a successful save, the server MUST return the new `contentHash` and the client MUST update its state. The cache stores blob SHAs (not commit SHAs). Mismatches cause false 409 conflicts on consecutive saves.

### CSP Updates Required for New External Domains

When adding ANY new external domain (CDN, API, tile server) or inline script, update `src/lib/csp.ts`. For `<script>` tags with nonces on SSR pages, use `is:inline nonce={cspNonce}`. For static pages, use bare `<script>` tags (Astro hashes them). Never mix these approaches — Astro hoists non-`is:inline` scripts, stripping `nonce` attributes.

### Dark Mode — Every Color Needs Both Variants

Every color change needs both light AND dark variants using the `dark-mode` mixin from `src/styles/_mixins.scss`. This has been a recurring source of bugs (white text on white backgrounds in dark mode, etc.). Never add a color without checking its dark mode appearance.

### Path Resolution — Never Use Relative Paths

NEVER use `path.resolve('relative/path')` — it resolves from `process.cwd()` which varies (Playwright starts from `e2e/`). Always use `import.meta.dirname` to compute an absolute base and resolve from there.

### Zod v4 (via Astro)

This project uses Zod v4 via `astro/zod` (NOT direct `zod` package). Key differences from v3:
- Use `z.record(z.string(), z.unknown())` not `z.record(z.unknown())`
- Use `z.looseObject()` instead of `.passthrough()`
- Always import from `astro/zod`, never `astro:content` or `zod`

### View Transitions

Pages with View Transitions re-render without full reloads. Scripts that initialize on `DOMContentLoaded` or module load won't re-run. Use `document.addEventListener('astro:page-load', init)` instead.

### Middleware Route Exclusions

`/api/auth/*` and `/api/reactions/*` are excluded from auth middleware. NEVER put endpoints that require authentication under `/api/auth/` — they will silently skip session validation. Use `/api/admin/` for authenticated non-content endpoints.

### Wrangler Config

NEVER add a `main` field to `wrangler.jsonc` — the Vite plugin validates file existence at build time before `dist/` exists, causing build failures. It gets patched post-build in CI.

### Map Markers

Never use default Leaflet/MapLibre marker icons — they don't work in Vite-bundled apps (broken image URLs). Use CSS-styled HTML markers (divIcon/HTML marker) or the project's existing marker patterns.

### SCSS Modern Compiler

Don't use deprecated Sass functions (`darken()`, `lighten()`, etc.). The project uses `api: 'modern-compiler'`.

### withBatch — Don't Await Inside Callbacks

`src/db/transaction.ts`'s `withBatch()` collects unawaited query builders. Awaiting inside the callback executes statements prematurely instead of batching them.

### authorize() Returns Response, Not Boolean

`authorize()` in `src/lib/authorize.ts` returns either a `SessionUser` or a `Response` (401/403). It is NOT a boolean check. For boolean UI-level checks, use `can()`.

### Admin Route Ordering

In `src/integrations/admin-routes.ts`, static routes MUST precede parameterized routes when they share a prefix (e.g., `/api/reactions/route/_starred` must come before `/api/reactions/[contentType]/[contentSlug]`).

### E2E Test Dates

Test fixture dates must be far in the future (2099) to avoid time-dependent breakage (e.g., `isPastEvent()` logic). NEVER delete the SQLite DB file while the Astro preview server is running — it orphans the connection.

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

- **Build-time** (`src/lib/config.ts`): reads `process.env` at module evaluation. Exports `CONTENT_DIR`, `CITY`, `cityDir`, `GIT_OWNER`, `GIT_DATA_REPO`, `SITE_URL`, `CONTACT_EMAIL`, `CDN_FALLBACK_URL`.
- **Runtime** (`src/lib/env.ts`): reads Cloudflare bindings or local env at request time. Provides `GITHUB_TOKEN`, `DB`, `BUCKET`, etc. via the `AppEnv` interface (`src/lib/app-env.ts`).

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

The app runs in hybrid mode: public pages are static (`prerender = true`), admin/API pages are server-rendered (`prerender = false`).

**Preact islands** (`src/components/admin/`): RouteEditor, EventEditor, PlaceEditor, MediaManager, VariantManager, RouteCreator, NearbyPhotos, PhotoField, EditHistory, UserList, SettingsForm, AuthGate, LoginForm, RegisterForm, SaveSuccessModal, StagingSyncButton, Toast. Shared hooks in `useEditorState.ts`.

**Auth system**: WebAuthn (passkeys) via `@simplewebauthn/server`. Three roles: `admin`, `editor`, `guest`. Session-based auth with 30-day cookies. Two cookies: `session_token` (httpOnly) and `logged_in` (readable by JS for CSS-based UI toggling via `admin-visible` class on `<body>`). WebAuthn challenges stored in short-lived (5-minute) httpOnly cookies, not DB.

**Middleware** (`src/middleware.ts`):
- `/admin/*` — full auth + nonce CSP
- `/api/*` (except `/api/auth/*`, `/api/reactions/*`) — full auth
- `/api/reactions/*` — no auth required, optionally loads user
- `/login`, `/register`, `/setup`, `/gate` — no auth, nonce CSP
- CSP nonce injection replaces `<script>` tags to add nonce attributes and deletes `content-length`

### Media URLs

Images and videos served from Cloudflare R2 via `R2_PUBLIC_URL` (with fallback to `getCityConfig().cdn_url`):
- **Images**: `R2_PUBLIC_URL/cdn-cgi/image/{transforms}/{blobKey}` — uses `import.meta.env.R2_PUBLIC_URL` (Vite-time)
- **Videos**: `R2_PUBLIC_URL/{blobKey}`
- **Video HLS**: `https://videos.ottawabybike.ca/{key}/{key}.m3u8`

### i18n — Three Layers

Locales are driven by city config (e.g., `[en-CA, fr-CA, es]` → `[en, fr, es]`). UI strings in `src/i18n/{en,fr,es}.json`.

**Layer 1 — UI strings**: `t()` helper with `{variable}` interpolation.

**Layer 2 — URL path segments** (`src/lib/path-translations.ts`): translates known top-level segments (e.g., `routes` → `parcours`). Slugs pass through unchanged. `localePages` in `i18n-routes.ts` and `segmentTranslations` must stay in sync — if you add a route to `localePages` without a translation entry, the French URL will use the English segment.

**Layer 3 — Content translations**: sidecar files (`index.fr.md` next to `index.md`). Routes with locale-specific slugs in translation frontmatter generate Cloudflare `_redirects` entries (200 rewrites + 301 redirects) at build time.

### Database

Drizzle ORM on SQLite (D1 in production, `better-sqlite3` locally). Schema in `src/db/schema.ts`, migrations in `drizzle/migrations/`.

Tables: `users`, `credentials` (WebAuthn), `sessions`, `banned_ips`, `upload_attempts` (rate limiting), `content_edits` (D1 content cache), `user_settings`, `reactions` (ridden/thumbs-up/star on routes and events).

`init-schema.ts` applies ALL migrations idempotently (rewrites `CREATE TABLE` to `IF NOT EXISTS`, swallows duplicate column errors). Local dev and E2E always get latest schema. D1 applies migrations sequentially. `content_edits` has a composite primary key: `(city, contentType, contentSlug)`.

### Reactions System

User reactions (ridden, thumbs-up, star) on routes and events. Spans: `reactions` table, `src/lib/reaction-types.ts`, `src/views/api/reactions.ts` + `reactions-get.ts` + `reactions-starred.ts`, `src/components/ReactionsWidget.tsx`. The `/api/reactions/*` paths are excluded from auth middleware but optionally load user for personalized responses.

### Contributors System

`scripts/build-contributors.ts` generates `.astro/contributors.json` from git log. Only shows users matched to a DB record — unknown git authors are excluded entirely. Display uses DB username, never git commit author name. Must run BEFORE `astro build` (consumed by `virtual:bike-app/contributors`).

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
  pages/          # File-based routing (public pages + auth API + feeds)
  schemas/        # Zod schemas for content collections (barrel export via index.ts)
  styles/         # SCSS — _variables.scss is the design token source of truth
  types/          # TypeScript types (admin.ts, mapbox-polyline.d.ts)
  views/          # Admin pages + API endpoints (injected via injectRoute)
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
11. `src/pages/admin/{types}.astro` — admin list page
12. `src/components/admin/{Type}Editor.tsx` — Preact island
13. `src/styles/admin.scss` — all editor styles (NOT scoped `<style>`)
14. `src/lib/load-admin-content.ts` — add list overlay function if needed

### Adding a New API Endpoint

1. Create file in `src/views/api/` (NOT `src/pages/api/` — exception: auth endpoints)
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

All styles must match production (ottawabybike.ca). Use SCSS variables from `src/styles/_variables.scss` — never hardcode colors or breakpoints. SCSS uses `api: 'modern-compiler'`.

Key variables: `$color-card-bg`, `$color-tag-bg`, `$color-btn-*`, `$border-radius`, `$breakpoint-*`, `$font-*`.

Dark mode uses `@media (prefers-color-scheme: dark)` via the `dark-mode` mixin — every color change needs both light and dark variants.

Three style layers:
- **`global.scss`** — public page styles, imported via `Base.astro`
- **`admin.scss`** — all admin/auth styles including Preact islands (scoped styles don't reach islands)
- **`_variables.scss` / `_mixins.scss`** — design tokens and mixins

The `logged_in` cookie enables JS to add `admin-visible` class to `<body>`, toggling CSS-hidden admin links (`.admin-edit-link`, `.nav-admin`) without server-rendering conditional logic on static pages.

## Testing

```sh
make test          # vitest unit tests (tests/)
make test-e2e      # build (CITY=demo) + playwright screenshot tests
make test-admin    # admin E2E tests (save flow, community editing, etc.)
make test-update   # rebuild screenshot baselines
make full          # build + validate + unit + all E2E
```

Screenshot tests build against `CITY=demo` (a fixture city), not Ottawa. Baselines tracked with Git LFS.

Admin E2E tests (`e2e/admin/`) use a fixture system (`fixture-setup.ts`) that:
- Creates isolated content directory at `.data/e2e-content/demo/`
- Initializes a git repo in the fixture (for `LocalGitService`)
- Creates SQLite DB at `.data/local.db`
- Builds with `RUNTIME=local`, runs `astro preview` on port 4323
- Uses a `.ready` sentinel to prevent duplicate setup across Playwright workers
- Clears ALL Astro caches before build to prevent stale data interference
- Bypasses WebAuthn by seeding sessions directly into SQLite
- Restores fixture files via `git show` (read-only, no index lock) to avoid contention

Key fixture gotchas: each writing spec owns its own route fixture for parallelization. The DB is NOT deleted between runs (server holds persistent connection). `seedSession()` handles per-test DB state.

## Build

```sh
make build         # astro build → dist/
make maps          # generate map thumbnail cache (public/maps/)
make validate      # validate content data
make contributors  # build contributor stats (must run BEFORE astro build)
make fonts         # download and embed Google Fonts
```

**Build order matters:** `make contributors` and `make maps` must run before `astro build` because they generate files consumed by virtual modules.

Build integrations in `astro.config.mjs`: `copy-map-cache`, `generate-redirects` (Cloudflare `_redirects` from multiple sources including translated slugs), `patch-static-csp-style-src` (rewrites Astro's style hashes to `unsafe-inline`).

CSP is split across four files: `src/lib/csp.ts` (shared directives), `src/middleware.ts` (nonce injection for dynamic pages), `astro.config.mjs` `security.csp` (static pages), and `patch-static-csp-style-src` (post-build fixup).

## Git Conventions

- Never add `Co-Authored-By` lines to commits
- Do not auto-commit — wait for explicit instructions
- PNGs are tracked with Git LFS

## Related Repos

- `~/code/bike-app` — Rails app (production source of truth for CSS matching). Plans/design docs go in `~/code/bike-app/docs/plans/`
- `~/code/bike-routes` — Content data repo (routes, guides, events, places)
- `~/code/bike-routes-golden-tests` — Golden test artifacts (production screenshots)

## Environment Variables

See `.env.example`:
- `RUNTIME` — `local` for offline dev (SQLite + filesystem + simple-git), unset for production
- `CONTENT_DIR` — path to bike-routes data repo (default: `../bike-routes`)
- `CITY` — city config to load (default: `ottawa`). E2E tests use `demo`
- `SITE_URL` — public site URL
- `CONTACT_EMAIL` — contact email address
- `GIT_OWNER` / `GIT_DATA_REPO` — GitHub repo coordinates (default: `eljojo`/`bike-routes`)
- `GITHUB_TOKEN` — fine-grained PAT for GitHub API (Contents + Pull requests R/W)
- `ENVIRONMENT` — `staging` or `production` (controls git branch and rebuild events)
- `GIT_BRANCH` — `staging` or `main` (set per environment in `wrangler.jsonc`)
- `R2_PUBLIC_URL` — media CDN base URL
- `STORAGE_KEY_PREFIX` — `staging/` for staging, empty for production
- `GOOGLE_MAPS_STATIC_API_KEY` — for map thumbnail generation
- `GOOGLE_PLACES_API_KEY` — for place data prefill
- `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` — WebAuthn relying party config
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` — R2 presigned upload
- `RWGPS_API_KEY` / `RWGPS_AUTH_TOKEN` — RideWithGPS API credentials

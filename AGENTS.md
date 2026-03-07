# Ottawa by Bike — Astro Rebuild

Static site rebuild of [ottawabybike.ca](https://ottawabybike.ca). Replaces a Rails app with an Astro static site generated from exported content data.

## Project Status

Active development on the `admin-interface` branch. The `main` branch is intentionally bare (just a README) — all work gets merged via PR.

## Quick Start

```sh
nix develop        # enter dev shell (node 22, vips, playwright)
make install       # npm install
make dev           # astro dev server on localhost:4321
```

Run `make` to see all available targets.

## Architecture

### Content Pipeline

Content lives in a separate data repo (`~/code/bike-routes`) and is loaded via Astro content collections. The `CONTENT_DIR` env var points to it (defaults to `../bike-routes`).

Collections: `routes`, `places`, `guides`, `events`, `organizers`, `pages` — defined in `src/content.config.ts`.

Routes use a custom loader (`src/loaders/routes.ts`) that parses GPX files and `media.yml`. Pages use a custom loader (`src/loaders/pages.ts`). Other collections use Astro's `glob` loader on markdown files. Translation files (`*.??.md`) are excluded from base loading and handled separately.

The route loader implements incremental caching via MD5 digest of file mtimes — unchanged routes are skipped on rebuild.

### Media URLs

Images and videos are served from Cloudflare R2 via `R2_PUBLIC_URL` (defaults to `https://cdn.ottawabybike.ca`).

- **Images**: `R2_PUBLIC_URL/cdn-cgi/image/{transforms}/{blobKey}` — see `src/lib/image-service.ts`
- **Videos**: `R2_PUBLIC_URL/{blobKey}` — see `src/lib/video-service.ts`
- **Video HLS**: `https://videos.ottawabybike.ca/{key}/{key}.m3u8`

Blob keys come from the Rails app's ActiveStorage and are stored in each route's `media.yml`.

### Admin Architecture

The app runs in hybrid mode (`astro.config.mjs`): public pages are static, admin/API pages are server-rendered. The admin uses Preact islands for interactive editing embedded in SSR Astro pages.

**Preact islands** (`src/components/admin/`): RouteEditor, EventEditor, MediaManager, VariantManager, RouteCreator, EditHistory, UserList, SettingsForm, AuthGate, LoginForm, RegisterForm, SaveSuccessModal, StagingSyncButton, Toast.

**Virtual modules** (`src/build-data-plugin.ts`): Vite plugin providing `virtual:bike-app/admin-routes`, `virtual:bike-app/admin-route-detail`, `virtual:bike-app/admin-events`, `virtual:bike-app/admin-event-detail`, `virtual:bike-app/admin-organizers`, `virtual:bike-app/cached-maps`, `virtual:bike-app/contributors`. Admin detail pages use a cache-overlay pattern (`src/lib/load-admin-content.ts`): D1 `content_edits` → fallback to virtual module build-time data.

**Save pipeline:** Editor → `POST /api/{content-type}/{slug}` → `content-save.ts` (auth, conflict detection via compare-and-swap) → `git-service.ts` (GitHub API commit) or `git-service-local.ts` (simple-git). Content-type-specific logic lives in handler objects implementing `SaveHandlers<T>` (`route-save.ts`, `event-save.ts`). After commit, D1 `content_edits` cache is updated with the new SHA.

**Auth system:** WebAuthn (passkeys) via `@simplewebauthn/server`. Three roles: `admin` (first registered user), `editor`, `guest` (anonymous with pseudonym). Session-based auth with 30-day cookies. Policy-based authorization in `src/lib/authorize.ts`. Ban system tracks users and IPs (`src/lib/ban-service.ts`). Middleware (`src/middleware.ts`) protects `/admin/*` and `/api/*` paths, injects CSP nonces for dynamic pages.

**Local dev:** Set `RUNTIME=local` in `.env` — swaps GitHub API for `simple-git`, D1 for SQLite, R2 for filesystem. Five adapter boundary points in `src/lib/`: `env.ts`, `git-factory.ts`, `get-db.ts`, `storage-local.ts`, `adapter.ts`.

**Dynamic routes:** API endpoints and admin pages live in `src/views/` and are injected via `injectRoute()` in `src/integrations/admin-routes.ts` (no bracket filenames).

### API Endpoints

File-based (`src/pages/api/`):
- `auth/*` — guest login, WebAuthn register/login/upgrade, logout
- `media/presign` + `media/confirm` — R2 upload flow (presign → PUT → confirm)
- `dev/upload` — local dev direct upload

Injected (`src/views/api/` via `admin-routes.ts`):
- `routes/[slug]`, `events/[...id]` — content save
- `media/[key]` — media delete (admin only)
- `admin/sync` — staging branch sync
- `admin/users` — ban/unban/promote
- `admin/history` — commit history with user resolution
- `admin/revert` — restore files at a commit SHA
- `admin/diff` — commit diff text
- `settings` — user settings (email-in-commits, analytics opt-out)
- `gpx/import-rwgps` — RideWithGPS route import

### Database

Drizzle ORM on SQLite (D1 in production, `better-sqlite3` locally). Schema in `src/db/schema.ts`, migrations in `drizzle/migrations/`.

Tables: `users`, `credentials` (WebAuthn), `sessions`, `banned_ips`, `upload_attempts` (rate limiting), `content_edits` (D1 content cache), `user_settings`.

`src/db/init-schema.ts` runs all migrations idempotently (used by local dev and E2E fixtures). `src/db/transaction.ts` provides `withBatch()` for atomic multi-statement execution.

### i18n

Two locales: English (default), French. UI strings in `src/i18n/{en,fr}.json` with `t()` helper. Path translations in `src/lib/path-translations.ts` (e.g. `routes` → `parcours`). Public routes get locale-prefixed copies via `src/integrations/i18n-routes.ts`. Content translations loaded from `*.{locale}.md` sidecar files.

### Key Directories

```
src/
  components/     # .astro components + admin Preact islands
  db/             # Drizzle schema, migrations init, transaction helper
  i18n/           # Locale JSON files (en.json, fr.json) + t() helper
  integrations/   # Astro integrations (route injection, i18n, build plugins)
  layouts/        # Base.astro (shell with header, nav, footer)
  lib/            # Service modules, adapters, save pipeline, auth
  loaders/        # Custom Astro content loaders (routes, pages, admin data)
  pages/          # File-based routing (public pages + auth API)
  schemas/        # Zod schemas for content collections
  styles/         # SCSS — _variables.scss is the design token source of truth
  views/          # Admin pages + API endpoints (injected via injectRoute)
drizzle/          # Migration SQL files
e2e/              # Playwright screenshot + admin E2E tests
public/           # Static assets (maps/, favicons)
scripts/          # Build-time scripts (maps, fonts, validation, contributors)
tests/            # Vitest unit tests (65+ test files)
```

## CSS & Styling

All styles must match production (ottawabybike.ca). Use SCSS variables from `src/styles/_variables.scss` — never hardcode colors or breakpoints that have a variable. SCSS uses `api: 'modern-compiler'` (configured in `astro.config.mjs`).

Key variables: `$color-card-bg`, `$color-tag-bg`, `$color-btn-*`, `$border-radius`, `$breakpoint-*`, `$font-*`.

Dark mode uses `@media (prefers-color-scheme: dark)` via the `dark-mode` mixin in `_mixins.scss` — every color change needs both light and dark variants.

Admin/auth styles go in `src/styles/admin.scss` — scoped `<style>` in .astro files doesn't reach Preact islands.

## Testing

```sh
make test          # vitest unit tests (tests/)
make test-e2e      # build + playwright screenshot tests (public pages)
make test-admin    # admin E2E tests (save flow, community editing, etc.)
make test-update   # rebuild screenshot baselines
make full          # build + validate + unit + all E2E
```

Screenshot baselines live in `e2e/snapshots/` and are tracked with Git LFS (all `*.png` files).

Admin E2E tests (`e2e/admin/`) use a fixture system (`fixture-setup.ts`) that creates isolated content directories and SQLite DBs. They rebuild with `RUNTIME=local` and run sequentially (shared state).

Production golden screenshots can be captured with `make screenshots` — they save to `~/code/bike-routes-golden-tests/screenshots/`.

`vitest.config.ts` includes `buildDataPlugin()` so virtual modules resolve in tests.

## Build

```sh
make build         # astro build → dist/
make maps          # generate map thumbnail cache (public/maps/)
make validate      # validate content data
make contributors  # build contributor stats from git log
make fonts         # download and embed Google Fonts
```

Build integrations in `astro.config.mjs`: `copy-map-cache` (copies maps into dist), `generate-redirects` (Cloudflare `_redirects` from multiple sources), `patch-static-csp-style-src` (fixes CSP for static pages).

## No Bracket Filenames (MANDATORY)

NEVER create files with `[` or `]` in their names (e.g. `[slug].astro`, `[id].ts`). Astro's file-based routing convention of bracket filenames is forbidden in this project.

Dynamic routes are registered via `injectRoute()` in Astro integrations. View files live in `src/views/` with plain names. See `src/integrations/i18n-routes.ts` for public routes and `src/integrations/admin-routes.ts` for admin/API routes.

## Vendor Isolation (MANDATORY)

NEVER import platform-specific modules (e.g. `cloudflare:workers`, AWS SDK, Vercel helpers) directly in application code. All platform APIs must be accessed through a single wrapper file in `src/lib/`. Application code imports from OUR modules only.

If a feature requires a non-portable cloud API, stop and raise it. Find a portable alternative or isolate it behind an abstraction first. One wrapper file per vendor concern — if they rename or break their API, only one file changes.

This applies to ALL cloud vendors equally. No exceptions.

## Git Conventions

- Never add `Co-Authored-By` lines to commits
- Do not auto-commit — wait for explicit instructions
- PNGs are tracked with Git LFS
- Branch `admin-interface` is the active development branch, PR'd against `main`

## Related Repos

- `~/code/bike-app` — Rails app (production source of truth for CSS matching)
- `~/code/bike-routes` — Content data repo (routes, guides, events, places)
- `~/code/bike-routes-golden-tests` — Golden test artifacts (production screenshots, HTML snapshots)

## Environment Variables

See `.env.example`:
- `RUNTIME` — `local` for offline dev (SQLite + filesystem + simple-git), unset for production
- `CONTENT_DIR` — path to bike-routes data repo (default: `../bike-routes`)
- `CITY` — city config to load (default: `ottawa`)
- `SITE_URL` — public site URL
- `CONTACT_EMAIL` — contact email address
- `GIT_OWNER` / `GIT_DATA_REPO` — GitHub repo coordinates (default: `eljojo`/`bike-routes`)
- `GITHUB_TOKEN` — fine-grained PAT for GitHub API (Contents + Pull requests R/W on bike-routes + bike-app-astro)
- `ENVIRONMENT` — `staging` or `production` (controls git branch and rebuild events)
- `GIT_BRANCH` — `staging` or `main` (set per environment in `wrangler.jsonc`)
- `R2_PUBLIC_URL` — media CDN base URL
- `STORAGE_KEY_PREFIX` — `staging/` for staging, empty for production
- `GOOGLE_MAPS_STATIC_API_KEY` — for map thumbnail generation
- `WEBAUTHN_RP_ID` / `WEBAUTHN_RP_NAME` / `WEBAUTHN_ORIGIN` — WebAuthn relying party config
- `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` / `R2_ACCOUNT_ID` / `R2_BUCKET_NAME` — R2 presigned upload credentials
- `RWGPS_API_KEY` / `RWGPS_AUTH_TOKEN` — RideWithGPS API credentials

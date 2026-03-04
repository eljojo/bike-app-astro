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

Collections: `routes`, `places`, `guides`, `events`, `organizers` — defined in `src/content.config.ts`.

Routes use a custom loader (`src/loaders/routes.ts`) that parses GPX files and media.yml. Other collections use Astro's `glob` loader on markdown files.

### Media URLs

Images and videos are served from Cloudflare R2 via `R2_PUBLIC_URL` (defaults to `https://cdn.ottawabybike.ca`).

- **Images**: `R2_PUBLIC_URL/cdn-cgi/image/{transforms}/{blobKey}` — see `src/lib/image-service.ts`
- **Videos**: `R2_PUBLIC_URL/{blobKey}` — see `src/lib/video-service.ts`
- **Video HLS**: `https://videos.ottawabybike.ca/{key}/{key}.m3u8`

Blob keys come from the Rails app's ActiveStorage and are stored in each route's `media.yml`.

### Admin Architecture

The app runs in hybrid mode: public pages are static, admin/API pages are server-rendered. The admin uses Preact islands for interactive editing (RouteEditor, EventEditor, MediaManager, VariantManager) embedded in SSR Astro pages.

**Save pipeline:** Editor → `POST /api/{content-type}/{slug}` → `content-save.ts` (auth, conflict detection, branch resolution) → `draft-service.ts` (draft branch + PR for non-admin saves) → `git-service.ts` (GitHub API commit). Content-type-specific logic lives in handler objects (`route-save.ts`, `event-save.ts`) that plug into the generic pipeline.

**Draft branches:** Guests and editors save to `drafts/{pseudonym}/{content-type}/{slug}` branches with auto-created PRs. Admins commit directly to main (unless in editor mode).

**Local dev:** Set `RUNTIME=local` in `.env` — swaps GitHub API for `simple-git`, D1 for SQLite, R2 for filesystem. Five adapter boundary points in `src/lib/`: `env.ts`, `git-factory.ts`, `get-db.ts`, `storage-local.ts`, `adapter.ts`.

**Dynamic routes:** API endpoints and admin pages live in `src/views/` and are injected via `injectRoute()` in `src/integrations/admin-routes.ts` (no bracket filenames).

### Key Directories

```
src/
  components/     # .astro components + admin Preact islands (RouteEditor, etc.)
  integrations/   # Astro integrations (route injection, i18n, build plugins)
  layouts/        # Base.astro (shell with header, nav, footer)
  lib/            # Service modules, adapters, save pipeline, auth
  loaders/        # Custom Astro content loaders
  pages/          # File-based routing (public + auth pages)
  views/          # Admin pages + API endpoints (injected via injectRoute)
  db/             # Drizzle schema + local SQLite setup
  schemas/        # Zod schemas for content collections
  styles/         # SCSS — _variables.scss is the design token source of truth
e2e/              # Playwright screenshot tests
tests/            # Vitest unit tests
scripts/          # Build-time scripts (map generation, validation)
```

## CSS & Styling

All styles must match production (ottawabybike.ca). Use SCSS variables from `src/styles/_variables.scss` — never hardcode colors or breakpoints that have a variable.

Key variables: `$color-card-bg`, `$color-tag-bg`, `$color-btn-*`, `$border-radius`, `$breakpoint-*`, `$font-*`.

Dark mode uses `@media (prefers-color-scheme: dark)` — every color change needs both light and dark variants.

## Testing

```sh
make test          # vitest unit tests (tests/)
make test-e2e      # build + playwright screenshot tests
make test-update   # rebuild screenshot baselines
make test-all      # unit + e2e
```

Screenshot baselines live in `e2e/snapshots/` and are tracked with Git LFS (all `*.png` files).

Production golden screenshots can be captured with `make screenshots` — they save to `~/code/bike-routes-golden-tests/screenshots/`.

## Build

```sh
make build         # astro build → dist/
make maps          # generate map thumbnail cache (_cache/maps/)
make validate      # validate content data
```

The build produces ~62 static pages. Map thumbnails are generated separately and copied into `dist/` during build via a custom Astro integration in `astro.config.mjs`.

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
- `CONTENT_DIR` — path to bike-routes data repo (default: `../bike-routes`)
- `CITY` — city config to load (default: `ottawa`)
- `RUNTIME` — `local` for offline dev (SQLite + filesystem + simple-git), unset for production
- `GITHUB_TOKEN` — fine-grained PAT for GitHub API (Contents + Pull requests R/W on bike-routes + bike-app-astro)
- `ENVIRONMENT` — `staging` or `production` (controls git branch and rebuild events)
- `R2_PUBLIC_URL` — media CDN base URL
- `GOOGLE_MAPS_STATIC_API_KEY` — for map thumbnail generation

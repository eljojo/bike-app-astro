# whereto.bike

Open-source cycling platform — the WordPress for cycling. One codebase, three modes: personal ride blogs, community route wikis, and randonneuring club archives. City-specific instances, community-maintained, multilingual by default. AGPL-licensed.

`CLAUDE.md` is a symlink to this file (`AGENTS.md`).

## Why This Exists

1. **Increase the number of first-time bicycle riders.**
2. **Tap into experienced riders to help achieve goal 1.**

Every product decision, every line of copy, every feature choice passes through these two goals.

## Who This Is For

Think about someone who loves cycling and wants to share it with someone they care about. They're looking for the right ride — somewhere worth going, not too far, good surface. Maybe there's a bakery at the turnaround point, or a lookout over the river, or a swimming spot for after. They need the information to be truthful, because this is how cycling clicks for a new person. Not through arguments or marketing, but through one good ride.

If the distance is off, if the surface info is missing, if nobody mentioned the hill or the great cafe at kilometre twelve — that ride goes differently. And someone who could have discovered that a bicycle is freedom might not try again.

That's what this software carries. A route wiki helps a city's riders find and share the good roads. A personal blog lets someone show, not tell, what cycling has given them. A club archive preserves the history of people who ride long distances together. Each mode models a real cycling initiative — and each one, done well, puts more people on bicycles.

A bicycle for the mind already exists. This is the other half.

### Take the path that leads to more cycling

When two approaches both work, choose the one that results in more people riding. This applies to everything — feature prioritisation, copy tone, default settings, what gets prominent placement. A route page that highlights the waterfall at kilometre eight does more for cycling than one that leads with elevation gain. A place index full of picnic spots and viewpoints does more than a list of bike shops.

Understand human psychology and work with it. Some people need reassurance — accurate distances, surface types, traffic info. Others need a reason to go — the destination, the scenery, the excuse to be outside. The platform must serve both: remove the fears *and* offer the carrot. Safety information is the floor. Joy is the ceiling.

---

## Ownership Mindset

You own the outcome, not just the task. This isn't a typical web app where bugs get patched next sprint. A route description might be the only thing standing between someone and their first ride. A club's event archive is the history of a community. A blog post is someone's memory of a ride they loved. The code you write carries real things for real people.

This changes how you work:

- **Search before creating.** Before adding a constant, helper, or type, grep for where it might already exist. Data should have one source of truth. If you need a list of values, find where the authoritative list lives and derive from it — don't create a second copy that will drift.

- **Trace all connections.** When removing or changing something, find every reference: code, styles, translations, types, tests, build config. Use grep. Removing a feature means removing the HTML elements, the CSS classes, the translation keys, the JS functions, the tests — all of it. If you're surprised by leftover references, you didn't trace thoroughly enough.

- **Delete, don't hide.** If something shouldn't exist, remove it completely. Don't comment it out, don't hide it with CSS, don't wrap it in a dead conditional. Dead code is confusing code.

- **Verify before claiming done.** After any change, grep for related terms, rebuild, run tests. Show proof, not promises. A claim without evidence is just a guess — and AI is particularly prone to confident guesses. If you say it works, show the output. If you say it's fixed, show the test passing.

- **Understand the system before changing it.** Read the existing implementation. Understand why it works the way it does. Match its patterns. This codebase has conventions — vendor isolation, data locality, the save pipeline pattern — that exist for good reasons. Learn them before proposing alternatives.

- **Model reality faithfully.** This platform succeeds by representing the cycling domain truthfully. A route is a real path someone rides. A place is a real location someone visits. An event is a real gathering with real participants. When the domain model is right, features follow naturally. When it's wrong, every feature is a workaround. Take domain-driven design seriously — the types, the names, the relationships should make a cyclist nod in recognition.

---

## Development Principles

- **Care and attention to detail.** This software helps people find rides, remember trips, and organise communities. Getting a distance wrong, dropping a waypoint, or breaking a map isn't a cosmetic issue — it's a broken promise to someone who trusted the information. Being thorough means checking your own work, matching the standards already in the codebase, and not leaving loose ends.

- **Empathy.** The people using this range from experienced randonneurs to someone Googling "bike rides near me" for the first time. Every page, every label, every default should make sense to the least experienced person who might see it. Never use absolute fitness language ("easy", "hard") — use relative framing ("shorter than most rides on this site"). Lend a hand, don't assume expertise.

- **Universality.** Three instance types, multiple languages, cities on every continent. The platform must not assume a single locale, a single measurement system, or a single way of organising cycling. What works for a randonneuring club in Santiago must work for a route wiki in Ottawa and a ride blog in Tokyo. Build for the general case. Hardcode nothing.

- **Show, don't tell.** Real photos taken by real people on real rides. Real routes ridden by someone who was there. No stock imagery, no AI-generated content, no pitching. The product speaks through what it contains, not what it claims. This applies to code too — show the test output, show the build passing, show the screenshot. Proof over promises.

- **Domain-driven design.** The codebase models cycling reality: routes, rides, tours, events, places, waypoints, organisers. These aren't arbitrary labels — they're how cyclists already think. When a new feature fits naturally into the domain model, it's probably right. When it needs workarounds and special cases, the model might need to grow. Take the domain seriously. Name things what cyclists call them. Let the structure of cycling inform the structure of the code.

- **Stand the test of time.** A club's event archive spans decades. A blog's ride history is a personal record. Content must not depend on a specific host, a specific API, or this project's continued existence. Data lives in Git as plain files — Markdown, YAML, GPX. Anyone can read it, fork it, move it. No lock-in. No proprietary formats. The content outlives the platform.

- **Tests verify claims.** If you can't demonstrate the test failing without your change, you can't be sure it's testing anything. Run the tests yourself before calling something done. Any change that touches user-facing behaviour needs a corresponding test. Don't leave verification to others.

- **Keep docs current.** When changing behaviour, update the relevant docs and AGENTS.md files in the same commit. Stale docs are worse than no docs — they teach the wrong thing with authority.

---

## Voice & Feel

The voice is a friend who loves cycling showing you around. Not a brand, not a guide, not an instructor — a person who rides this road and wants you to enjoy it too. The warmth is real but not performed. You shouldn't be able to point at any one sentence and say "that's the friendly sentence." The friendliness is structural: it's in the clarity, the pacing, the fact that someone thought about what you'd need to know.

**What to avoid isn't enthusiasm — it's *performed* enthusiasm.** "You're gonna love this trail!" is performing. A description that mentions the river view at the halfway point and the cafe where you can refill your water is genuinely helpful — and that helpfulness is warm.

**The core principle:** write like someone who took time to choose these words. Not someone filling in a template, not someone trying to sound upbeat. A person who rides, writing for someone who might.

**Cadence:**
- Sentences that don't rush. Short is fine. But not clipped.
- Words that feel placed, not emitted.
- Room for a human touch — a detail only someone who rode there would mention. Not every line needs to be minimal.

**Concrete rules:**
- Prefer human words over technical ones. "Ride" not "route segment." "Turn around at the lighthouse" not "reverse direction at waypoint 7."
- Address people directly. "You'll pass a bakery at kilometre four" not "There is a bakery located at kilometre four."
- No exclamation marks in UI copy. Period.
- Use em dashes ( — ) not double hyphens (--) or unspaced dashes.
- Drop filler: "simply", "just", "easily", "basically."
- Contractions are fine where they sound natural. Don't force them and don't avoid them.
- Never use absolute fitness language. "Shorter than most rides on this site" not "An easy ride." "Steady climb for 2 km" not "A hard hill."
- Places matter. Mention the cafe, the viewpoint, the swimming spot, the bench with the good shade. These are why people ride.

**The vibe:**
- Not: "You're gonna crush this ride!" (performed enthusiasm)
- Not: "Proceed along the designated cycling path." (mechanical)
- Not: "This route is 12 km." (correct but lifeless)
- But: "Twelve kilometres along the river. There's a good spot to stop at the bridge."

Warm, clear, human. Like someone who's been there.

---

## Brand & Product Framing

- **whereto.bike** — Global cycling platform (umbrella brand, AGPL)
- **ottawabybike.ca** — Ottawa instance, established local brand (est. 2022), "powered by whereto.bike"
- **{city}.whereto.bike** — Future city subdomains
- **Three instance types:** wiki (community route database), blog (personal ride journal), club (randonneuring/event archive). One codebase, conditionally enabled features. See `instance_type` in city config.
- **Rider first, contributor second.** Lead with utility (find a ride), not contribution (add a GPX).
- **Human over algorithmic.** Every photo was taken by someone who was there. Every route was ridden by a real person.
- **Don't name competitors.** Let the product speak for itself.

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
- **No ClientRouter**: the site does NOT use Astro's `<ClientRouter />` (View Transitions). Use `DOMContentLoaded`, not `astro:page-load`.
- **Middleware exclusions**: `/api/auth/*` and `/api/reactions/*` skip auth — don't put protected endpoints there.
- **Wrangler config**: `main` points to `./src/worker-entry.ts` (custom Worker entry with `fetch` + `scheduled` for cron triggers). The Cloudflare Vite plugin compiles this into `dist/server/entry.mjs` at build time. The CI post-build step patches `main` to the compiled output for deployment. Do not set `main` to a built output path directly — Vite validates the file exists at build time.
- **Map markers**: never use default MapLibre markers — use CSS-styled HTML markers.
- **Zod v4**: import from `astro/zod`, not `zod`. Use `z.record(z.string(), z.unknown())`, `z.looseObject()`.

---

## Architecture

### Instance Types

The codebase serves three instance types from one codebase: **wiki** (community route database, default), **blog** (personal ride journal), and **club** (randonneuring/event archive). The type is set via `instance_type` in the city's `config.yml`.

**Feature flags, not identity checks.** Use `getInstanceFeatures()` from `src/lib/instance-features.ts` for capability checks (e.g., `features.hasRides`, `features.hasEvents`, `features.allowsRegistration`). Reserve `isBlogInstance()`/`isClubInstance()` for structural decisions like which loaders, virtual modules, or admin routes to register. See `src/lib/AGENTS.md` for details.

**Rides reuse the routes infrastructure.** Blog instances store rides as GPX files with optional sidecar Markdown, but they flow through the same `routes` content collection, the same `admin-routes`/`admin-route-detail` virtual modules, and the same admin editor pipeline. The admin-rides loader (`src/loaders/admin-rides.ts`) populates these modules on blog instances instead of the route loader. Ride-specific types (`RideDetail`, `AdminRideDetail`) extend the shared content model in `src/lib/models/ride-model.ts`.

**Shared content model base.** All content types share `GitFileSnapshot`, `GitFiles`, `computeHashFromParts`, and `baseMediaItemSchema` from `src/lib/models/content-model.ts`. Type-specific models (`route-model.ts`, `ride-model.ts`, `event-model.ts`, `place-model.ts`) extend from these.

### Content Pipeline

Content lives in a separate data repo (`~/code/bike-routes`) and is loaded via Astro content collections. The `CONTENT_DIR` env var points to it (defaults to `../bike-routes`). The `CITY` env var (defaults to `ottawa`) selects which city's data to load. City config is read from `{CONTENT_DIR}/{CITY}/config.yml`.

Collections: `routes`, `places`, `guides`, `events`, `organizers`, `pages` — defined in `src/content.config.ts`. Translation files (`*.??.md`) are excluded from base loading and handled separately.

Routes are special — they use a custom loader (`src/loaders/routes.ts`) that:
- Parses directory-based structure (`routes/{slug}/` with `index.md`, `media.yml`, `variants/`, GPX files)
- Implements incremental caching via MD5 digest of file mtimes
- Parses GPX XML and renders markdown at load time
- Loads locale translations from sidecar files

Rides (blog instances) live under `{CITY}/rides/` as GPX files with optional sidecar `.md` and `-media.yml` files. Tour grouping is detected from directory structure. The rides loader (`src/loaders/rides.ts`) handles GPX parsing and tour detection; the admin rides loader (`src/loaders/admin-rides.ts`) builds tour aggregates and ride stats.

Pages use a custom loader (`src/loaders/pages.ts`). Other collections use Astro's `glob` loader.

### Data Locality Principle

Data lives next to what uses it. Route photos live in the route's `media.yml`. Place photos live in the place's frontmatter. This colocation is a core architectural choice — never centralize data that belongs to a specific content item. City-level files (like `parked-photos.yml`) exist only for data with no content item to live next to.

When building query layers over distributed data, the index is a **computed view** — never the canonical store.

### Configuration Layers

Two distinct config layers — don't confuse them:

- **Build-time** (`src/lib/config.ts`): reads `process.env` at module evaluation. Exports `CONTENT_DIR`, `CITY`, `cityDir`, `SITE_URL`, `CONTACT_EMAIL`, `CDN_FALLBACK_URL`.
- **Runtime** (`src/lib/env/env.service.ts`): reads Cloudflare bindings or local env at request time. Provides `GITHUB_TOKEN`, `DB`, `BUCKET`, `GIT_OWNER`, `GIT_DATA_REPO`, etc. via the `AppEnv` interface (`src/lib/app-env.ts`).

City-specific config is loaded from `{cityDir}/config.yml` by `src/lib/city-config.ts` and defines: display name, CDN URLs, tile server, timezone, locales, map bounds, place categories, analytics domain, and author info. Locales are derived from the city config (e.g., `[en-CA, fr-CA]` → `[en, fr]`), not hardcoded.

### Five Adapter Boundary Points

The local-vs-production switch (`RUNTIME=local`) is checked at five isolation boundaries:

| Boundary | Local | Production |
|----------|-------|------------|
| `src/lib/env/env.service.ts` | `env.adapter-local.ts` (imports `db/local.ts`, triggers DB init) | `cloudflare:workers` |
| `src/lib/env/adapter.ts` | `@astrojs/node` standalone | `@astrojs/cloudflare` |
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

Implementations: `src/views/api/route-save.ts`, `src/views/api/ride-save.ts`, `src/views/api/event-save.ts`, `src/views/api/place-save.ts`.

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
  lib/models/     # Canonical type defs: content-model.ts (shared base), route-model.ts, ride-model.ts, event-model.ts, place-model.ts
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
make lint          # ESLint checks (src/)
make typecheck     # TypeScript type checking (tsc --noEmit)
make test          # vitest unit tests (tests/)
make test-e2e      # build (CITY=demo) + playwright screenshot tests
make test-admin    # admin E2E tests (save flow, community editing, etc.)
make full          # build + validate + unit + all E2E
```

**Run `make lint` and `make typecheck` before committing.** CI enforces both — catch errors locally first.

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

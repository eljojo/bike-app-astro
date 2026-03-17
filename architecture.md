# Architecture

Visual overview of whereto.bike's architecture. For implementation details, conventions, and gotchas, see `AGENTS.md`.

---

## 1. Data Models

Content types share a base contract (`GitFileSnapshot`, `GitFiles`, `computeHashFromParts`) defined in `src/lib/models/content-model.ts`. Each type extends this with its own schema, hash function, and git/cache serialization.

```mermaid
erDiagram
    Route {
        string slug PK
        string name
        string tagline
        string status
        number distance
        string[] tags
        string body
    }
    Route ||--o{ Variant : "has"
    Variant {
        string name
        string gpx
        number distance_km
    }
    Route ||--o{ MediaItem : "has"

    Ride {
        string slug PK
        string name
        string ride_date
        string tour_slug
        string contentHash
        number elapsed_time_s
        number average_speed_kmh
    }
    Ride ||--o{ Variant : "has"
    Ride ||--o{ MediaItem : "has"

    Event {
        string id PK
        string slug
        string year
        string name
        string start_date
        string[] routes
    }
    Event ||--o{ Waypoint : "has"
    Event ||--o{ Result : "has (club)"
    Event ||--o{ MediaItem : "has"
    Event }o--o| Organizer : "organized by"

    Waypoint {
        string place
        string type
        number distance_km
    }
    Waypoint }o--o| Place : "references"

    Place {
        string id PK
        string name
        string category
        number lat
        number lng
    }

    Organizer {
        string name PK
        string website
        string instagram
    }

    MediaItem {
        string key PK
        string caption
        number lat
        number lng
    }
```

Key files:

- `src/lib/models/content-model.ts` -- shared base (`GitFileSnapshot`, `GitFiles`, `baseMediaItemSchema`)
- `src/lib/models/route-model.ts` -- `RouteDetail`, variants, media with upload tracking
- `src/lib/models/ride-model.ts` -- `RideDetail`, GPX-derived metrics, tour grouping
- `src/lib/models/event-model.ts` -- `EventDetail`, waypoints, results, registration
- `src/lib/models/place-model.ts` -- `PlaceDetail`, geo-located points of interest
- `src/schemas/index.ts` -- Zod schemas for content collections (public-facing)

---

## 2. Data Stores

Four data stores, each serving a distinct role. Content flows from the Git repo through build-time processing into virtual modules, with D1 and R2 handling runtime state.

```mermaid
flowchart LR
    subgraph Git["Content Repo (Git)"]
        MD["Markdown + YAML"]
        GPX["GPX tracks"]
        Media["media.yml"]
    end

    subgraph Build["Build Time"]
        Loaders["Astro Loaders<br/>(routes, rides, pages)"]
        Scripts["Pre-build Scripts<br/>(contributors, maps)"]
        Plugin["build-data-plugin.ts<br/>(virtual modules)"]
    end

    subgraph Runtime["Runtime Stores"]
        D1["D1 / SQLite"]
        R2["R2 / Local FS"]
    end

    subgraph Static["Static Output"]
        HTML["Pre-rendered HTML"]
        VM["Virtual Module<br/>Snapshots"]
    end

    Git --> Loaders
    Git --> Scripts
    Loaders --> Plugin
    Scripts --> Plugin
    Plugin --> VM
    Loaders --> HTML

    VM -- "fallback data" --> D1
    D1 -- "cache overlay<br/>(content_edits)" --> VM

    R2 -- "media uploads<br/>(photos, videos)" --> HTML
```

**Content repo** (`CONTENT_DIR`): Git repository with Markdown, YAML, and GPX files. The source of truth for all content. Structure: `{city}/routes/`, `{city}/events/`, `{city}/places/`, `{city}/rides/`.

**D1 / SQLite** (`src/db/schema.ts`): Runtime database with tables for `content_edits` (post-deploy cache overlay), `users`, `credentials`, `sessions`, `reactions`, `video_jobs`, `upload_attempts`, `email_tokens`, `user_settings`, and `strava_tokens`. Admin pages merge D1 cache entries over virtual module snapshots via `src/lib/content/load-admin-content.ts`.

**R2 / Local FS** (`src/lib/storage/storage-local.ts`): Blob storage for uploaded media. Photos served via `cdn-cgi/image/` transform URLs. Videos served directly.

**Virtual modules** (`src/build-data-plugin.ts`): 13+ modules compiled at build time. Admin content modules (`admin-routes`, `admin-route-detail`, etc.) provide the baseline data that D1 cache entries overlay. Photo index modules aggregate geolocated media across content types.

---

## 3. CI Pipelines

```mermaid
flowchart TD
    subgraph Trigger
        PR["Pull Request"]
        Push["Push to main"]
        Dispatch["repository_dispatch<br/>(data-updated)"]
    end

    subgraph CI["CI Pipeline (_test.yml)"]
        Lint["ESLint"]
        Types["tsc --noEmit"]
        Unit["Vitest"]
        MapStyle["Build map style"]
        Maps["Generate map thumbnails"]
        Contributors["Build contributor stats"]
        AstroBuild["astro build (CITY=demo)"]
        Validate["Validate build output"]
        E2E["Playwright E2E<br/>(screenshot tests)"]
        AdminE2E["Admin E2E<br/>(save flow tests)"]
        BlogE2E["Blog E2E"]
        ClubE2E["Club E2E"]
    end

    subgraph Deploy["Production Deploy"]
        Detect["Detect changed cities"]
        BuildOttawa["Build + Deploy Ottawa"]
        BuildDemo["Build + Deploy Demo"]
        BuildBrevet["Build + Deploy Brevet"]
        Migrations["D1 Migrations<br/>(Ottawa only)"]
        ClearCache["Clear stale<br/>content_edits"]
    end

    PR --> CI
    Lint --> AstroBuild
    Types --> AstroBuild
    Unit --> AstroBuild
    MapStyle --> AstroBuild
    Maps --> AstroBuild
    Contributors --> AstroBuild
    AstroBuild --> Validate --> E2E
    E2E --> AdminE2E --> BlogE2E --> ClubE2E

    Push --> Detect
    Dispatch --> Detect
    Detect --> BuildOttawa & BuildDemo & BuildBrevet
    BuildOttawa --> Migrations --> ClearCache
```

**Build order**: `build-map-style` + `generate-maps` + `build-contributors` must run before `astro build` because they generate files consumed by virtual modules and static assets.

**Test matrix**: lint, typecheck, and unit tests run in parallel before the build. E2E suites (screenshot, admin, blog, club) run sequentially after the build, all against `CITY=demo`.

**Production deploy** (`production.yml`): Triggered by push to main or `data-updated` webhook from the content repo. Uses a matrix strategy to build/deploy Ottawa, demo, and brevet in parallel. D1 migrations run only in the Ottawa job (all cities share one database). After deploy, stale `content_edits` rows (older than `BUILD_START`) are purged.

**Staging** (`staging.yml`): Triggered by `staging-data-updated` webhook or manual dispatch. Deploys Ottawa only, using `data-ref: staging`.

Key files: `.github/workflows/ci.yml`, `_test.yml`, `_build-city.yml`, `production.yml`, `staging.yml`.

---

## 4. Instance Types

One codebase serves three instance types, selected via `instance_type` in `{city}/config.yml`. Feature flags drive capability checks -- use `getInstanceFeatures()` for UI/content decisions, `isBlogInstance()`/`isClubInstance()` only for structural choices (loaders, virtual modules).

```mermaid
flowchart TB
    subgraph Config["City Config (config.yml)"]
        IT["instance_type: wiki | blog | club"]
    end

    Config --> Features["getInstanceFeatures()"]

    Features --> Wiki["Wiki Instance"]
    Features --> Blog["Blog Instance"]
    Features --> Club["Club Instance"]

    subgraph Wiki
        WR["Routes + Guides"]
        WE["Community Events"]
        WP["Places"]
        WA["Open Registration"]
        WRx["Reactions"]
    end

    subgraph Blog
        BR["Rides (GPX + sidecar)"]
        BT["Tour Grouping"]
        BN["Single Author"]
        BS["Strava Sync"]
    end

    subgraph Club
        CR["Routes"]
        CE["Enriched Events<br/>(waypoints, results)"]
        CP["Places"]
        CA["Open Registration"]
        CC["ACP Club Code"]
    end
```

| Capability | Wiki | Blog | Club |
|---|---|---|---|
| Routes | yes | -- | yes |
| Rides (GPX journal) | -- | yes | -- |
| Events | yes | -- | yes |
| Enriched events (results, waypoints) | -- | -- | yes |
| Places | yes | -- | yes |
| Guides | yes | -- | -- |
| Community registration | yes | -- | yes |
| Reactions | yes | -- | yes |
| License notice | yes | -- | yes |

Content loading adapts per instance: blog instances use `rideLoader()` for the `routes` collection instead of `routeLoader()` (`src/content.config.ts`). Active content types are enumerated by `getContentTypes()` in `src/lib/content/content-types.ts`, which filters the registry against instance features.

Key files: `src/lib/config/instance-features.ts`, `src/lib/config/city-config.ts`, `src/lib/content/content-types.ts`.

---

## 5. Static vs Server-Rendered

Public pages are pre-rendered at build time (`prerender = true`). Admin pages and API endpoints are server-rendered (`prerender = false`). Every page and endpoint must explicitly export a `prerender` flag.

```mermaid
flowchart LR
    subgraph Static["Pre-rendered (build time)"]
        Routes["Route pages"]
        Events["Event pages"]
        Places["Place index"]
        Guides["Guide pages"]
        Home["Home / listing pages"]
    end

    subgraph Server["Server-rendered (request time)"]
        Admin["Admin pages<br/>(/admin/*)"]
        API["API endpoints<br/>(/api/*)"]
        Auth["Auth pages<br/>(/login, /register, /gate)"]
    end

    subgraph MW["Middleware (src/middleware.ts)"]
        AuthCheck["Session validation"]
        CSP["Nonce CSP injection"]
        Redirect["Ride redirects"]
    end

    Server --> MW
    MW -- "validates session" --> AuthCheck
    MW -- "injects nonce" --> CSP

    AuthCheck -- "401/redirect" --> Unauthed["Unauthenticated"]
    AuthCheck -- "user in locals" --> Authed["Authenticated"]

    subgraph Unprotected["Auth-exempt API routes"]
        ReactionsAPI["/api/reactions/*"]
        AuthAPI["/api/auth/*"]
        TilesAPI["/api/tiles/*"]
    end
```

**Middleware** (`src/middleware.ts`) runs only on server-rendered routes:

- **Auth check**: Admin pages and API endpoints (except `/api/auth/*`, `/api/reactions/*`, `/api/tiles/*`) require a valid session. Missing/expired sessions get 401 (API) or redirect to `/gate` (pages).
- **CSP nonce**: Admin pages and auth pages (`/login`, `/register`, `/setup`, `/gate`, `/auth/verify`) receive a per-request nonce injected into all `<script>` tags.
- **Ride redirects**: Old ride slugs are matched against a virtual module and 301-redirected.

**Data flow difference**: Static pages read from Astro content collections (populated by loaders at build time). Server-rendered admin pages read from virtual module snapshots overlaid with D1 `content_edits` cache. API save endpoints write to both Git (via GitHub API or local git) and D1 cache simultaneously.

Key files: `src/middleware.ts`, `src/lib/content/content-save.ts`, `src/lib/content/load-admin-content.ts`.

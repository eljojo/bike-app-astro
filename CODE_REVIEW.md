# Phase B Code Review -- Astro Rebuild

**Reviewer**: Senior Code Reviewer (automated)
**Date**: 2026-03-01
**Branch**: `astro-rebuild` (27 commits, `70b889f..356c5e7`)
**Spec**: `~/code/bike-app/docs/detailed_plan.md` (Phase B)
**Reference**: Rails app at `~/code/bike-app`

---

## Summary

This is a strong implementation that covers the vast majority of Phase B requirements. The app is architecturally sound, follows the spec's static-first principles, has good test coverage for the core computation modules, and includes a well-designed CI/CD pipeline with automated visual regression testing. The data insights implementation is particularly well done -- all six v1 insights are present and tested.

Below are detailed findings organized by review dimension. Severity levels:

- **Critical** -- Blocks merge or causes production breakage
- **Important** -- Should fix before launch
- **Minor** -- Nice to have, can address post-launch
- **Note** -- Observations, not issues

---

## 1. Spec Compliance

### Phase B.1: Foundation

| Requirement | Status | Details |
|---|---|---|
| Astro project, `output: 'static'` | Done | `astro.config.mjs` line 4: `output: 'static'` |
| Content Collections + Zod schemas | Done | `src/content.config.ts` defines routes, places, guides, events, organizers with Zod schemas in `src/schemas/index.ts` |
| Custom route loader | Done | `src/loaders/routes.ts` -- reads markdown + GPX + media.yml per route folder |
| Place-route proximity (300m) | Done | `src/lib/proximity.ts` using @turf/nearest-point-on-line, 300m threshold |
| Service adapter interfaces | Partial | See finding below |
| CONTENT_DIR + CITY env vars | Done | `src/lib/config.ts` reads both env vars with defaults |

**Important: Service adapter interfaces are not implemented as formal interfaces.** The spec calls for "service adapter interfaces" (StorageService, ImageService, etc.) as a vendor abstraction layer. The current implementation has concrete functions in `src/lib/image-service.ts` and `src/lib/video-service.ts` that directly build Cloudflare-specific URLs. There are no TypeScript interfaces defined, no adapter pattern, no factory file.

This is a reasonable pragmatic choice for v1 -- the spec explicitly says "Don't build adapters ahead of time. Build the interface + the one you need." However, the current code *does not define* the interface at all. The image service directly concatenates CDN URLs with `/cdn-cgi/image/` transforms, which is Cloudflare-specific. If the CDN changes, multiple files need updating.

**Recommendation**: At minimum, document the current functions as "the interface" with a comment noting the Cloudflare dependency. Ideally, extract an `ImageService` interface (TypeScript type) that the current implementation satisfies, so future adapters have a contract to implement.

### Phase B.2: CSS & Design System

| Requirement | Status | Details |
|---|---|---|
| Audit production visual output | Done | Screenshot-based E2E tests compare against production |
| Extract design tokens | Done | `src/styles/_variables.scss` -- fonts, colors, breakpoints, spacing |
| Base layout, typography, responsive | Done | 604-line `global.scss` with mobile/tablet/desktop breakpoints |
| Self-hosted fonts | Done | Google Fonts downloaded to `public/fonts/`, preloaded via `src/lib/fonts.ts` |

**Note**: The CSS approach is solid. Variables are well-organized, and the font auto-detection from SCSS (`src/lib/fonts.ts`) is a clever solution that avoids manual preload maintenance.

### Phase B.3: Core Components

| Component | Status | File |
|---|---|---|
| SEO | Done | `src/components/SEO.astro` -- title, meta description, OG, Twitter, canonical, breadcrumbs, JSON-LD |
| RouteCard | Done | `src/components/RouteCard.astro` -- cover photo, map thumbnail, tags, distance, body preview |
| RouteDetail | Done | `src/pages/routes/[slug].astro` -- hero photo, metadata, elevation, variants, nearby places, gallery, videos, similar routes |
| PlaceCard | Not implemented | No standalone PlaceCard component exists |
| GuideArticle | Done | `src/pages/guides/[slug].astro` |
| EventCard | Done | `src/components/EventCard.astro` |
| PhotoGrid/PhotoGallery | Done | `src/components/PhotoGallery.astro` -- PhotoSwipe with dynamic captions, "show all" button, score-based filtering |
| VideoPlayer | Done | Inline `<video>` with HLS/AV1/H264 sources in route detail and show pages |
| Breadcrumbs | Partial | JSON-LD breadcrumbs exist; no visible breadcrumb navigation rendered in HTML |

**Minor: No standalone PlaceCard component.** The spec lists PlaceCard as a core component, but places are rendered inline in `NearbyPlaces.astro` as list items. This is fine for current usage, but a reusable PlaceCard would be needed if places ever get their own pages.

**Minor: Breadcrumbs are JSON-LD only.** The spec says "Breadcrumbs" as a component. Breadcrumb JSON-LD is implemented (`src/lib/json-ld.ts` `breadcrumbJsonLd`) and rendered in route detail, guide detail, and route map pages. However, no visible breadcrumb trail is rendered in HTML. The Rails app also uses breadcrumb navigation on guide pages. This is a minor SEO/UX gap.

### Phase B.4: Island Components

| Component | Status | File |
|---|---|---|
| LeafletMap | Done | `src/components/LeafletMap.astro` -- polylines, place markers, geolocation button |
| PhotoGallery (PhotoSwipe) | Done | `src/components/PhotoGallery.astro` -- PhotoSwipe lightbox with dynamic captions and object position |
| ElevationProfile | Done | `src/components/ElevationProfile.astro` -- SVG-based elevation chart |
| BigMap | Done | `src/components/BigMap.astro` -- all routes + places + geolocation |

**Note**: All four island components are implemented. The ElevationProfile uses a static SVG approach rather than a chart library, which is lightweight and appropriate for static sites.

### Phase B.5: Static Pages

| Page | Status | File | Notes |
|---|---|---|---|
| Homepage (routes index) | Done | `src/pages/index.astro` | Tag filtering, route cards, distance sorting |
| Route detail | Done | `src/pages/routes/[slug].astro` | Full implementation |
| Route map | Done | `src/pages/routes/[slug]/map/index.astro` + `[variant].astro` | Per-variant maps |
| Guide pages | Done | `src/pages/guides/index.astro` + `[slug].astro` | |
| Calendar | Done | `src/pages/calendar.astro` | Upcoming/past events, show/hide toggle |
| Big map | Done | `src/pages/map.astro` | All routes + places |
| About | Done | `src/pages/about.astro` | |
| Videos index | Done | `src/pages/videos/index.astro` | Grouped by route |
| Video show | Done | `src/pages/videos/[handle].astro` | Individual video pages with "other videos" |
| GPX downloads | Done | `src/pages/routes/[slug]/[variant].gpx.ts` | Per-variant GPX files |
| iCal | Done | `src/pages/calendar.ics.ts` | Full VTIMEZONE, per-event VEVENTs |
| Sitemap (XML) | Done | `src/pages/sitemap.xml.ts` | Routes, guides, static pages |
| Sitemap (HTML) | Done | `src/pages/sitemap.astro` | Human-readable with video links |
| RSS | Done | `src/pages/rss.xml.ts` | Routes as items |
| llms.txt | Done | `src/pages/llms.txt.ts` | Routes, guides, pages |
| robots.txt | Done | `src/pages/robots.txt.ts` | Disallow for staging |
| Redirects | Done | `astro.config.mjs` integration | From redirects.yml + per-route redirects |

**Note**: Complete coverage of all specified pages. The addition of video show pages (`/videos/[handle]`) and the HTML sitemap go beyond the minimum spec.

### Phase B.6: Launch Items

| Requirement | Status | Details |
|---|---|---|
| Golden tests | Not implemented | See finding below |
| Redirects applied | Done | `_redirects` generated from `redirects.yml` + per-route `redirects.yml` files |
| Analytics | Done | Plausible with custom events (gallery, tag filter, video plays, link clicks, social referrals, repeat visits) |
| Visual regression | Done | Playwright screenshot tests for 8 page types |

**Important: Golden tests are not implemented.** The spec defines golden tests as the acceptance criteria: "spider production ottawabybike.ca, capture every URL, record HTTP status, title, h1, meta description, canonical URL, JSON-LD, key content" and then assert the new app matches. There is a `capture-production.config.ts` and `capture-production.spec.ts` for screenshot capture, but no content-level golden test suite that compares title/meta/JSON-LD between the Rails app and Astro output.

The validation script (`scripts/validate.ts`) checks that expected pages exist in `dist/` but does not compare content against the production site.

**Recommendation**: Before DNS cutover, run the spider export from Phase A (`rake export:spider`) and build a comparison test. This is the most important pre-launch verification.

---

## 2. Architecture Alignment

### What aligns well with the spec:

1. **Static-first**: `output: 'static'` confirmed. No server-rendered pages. The `dist/` folder is self-contained.

2. **Two-repo model**: Data from `CONTENT_DIR` env var (default `../bike-routes`), city from `CITY` env var. Content and code are separate.

3. **Multi-city ready**: City config loaded from `{CONTENT_DIR}/{CITY}/config.yml`. The `CityConfig` interface in `src/lib/city-config.ts` handles city-specific values.

4. **Content Collections with Zod**: Routes use custom loader, places/guides/events/organizers use glob loaders. All have Zod schemas.

5. **Custom route loader**: `src/loaders/routes.ts` reads route folders with markdown + GPX + media.yml, exactly as specified.

6. **Build-time computation**: All data insights (proximity, similarity, difficulty, elevation tags, shape, place counts) computed at build time in `getStaticPaths`. No runtime queries.

7. **Cloudflare Workers deployment**: `wrangler.jsonc` configured with static assets directory.

### Architecture deviations and concerns:

**Important: Custom route loader does not use Astro's incremental caching.**

The spec explicitly describes using `meta.set('file-hash', hash)` and `digest` for incremental caching in the custom loader. The current `src/loaders/routes.ts` re-reads and re-parses all GPX files on every build. The `load` function receives `{ store, logger }` but never uses `meta` or `digest`.

At the current scale (28 routes), this is not a performance problem. But the spec identifies GPX parsing as "the most expensive build step" and the caching pattern as a key optimization. As the site grows, this will matter.

Relevant code in `src/loaders/routes.ts`:
```typescript
load: async ({ store, logger }) => {
  // No use of meta.get/set or digest
  // Re-reads all GPX files every build
  for (const slug of slugs) {
    // ... reads index.md, media.yml, all GPX files ...
    store.set({ id: slug, data: {...}, body });
  }
}
```

**Minor: `astro.config.mjs` has the site URL hardcoded.**

Line 3: `site: 'https://ottawabybike.ca'`. The spec says multi-city from day one, and the city config already has a `url` field. However, Astro's `site` config is set before content is loaded, so reading from city config at config time may not be possible. This is acceptable but worth noting.

**Note: No `@astrojs/cloudflare` adapter in the dependency list.**

The spec mentions `@astrojs/cloudflare` as the deployment adapter. Since the site is `output: 'static'`, no adapter is needed -- static files are served by the Worker's static asset handling. This is correct behavior. The `wrangler.jsonc` configuration points to `./dist` directly.

---

## 3. Feature Parity with Rails App

### Route Pages

| Feature | Rails | Astro | Match? |
|---|---|---|---|
| Hero cover photo | Yes | Yes | Yes |
| Title + tagline | Yes | Yes | Yes |
| Tag pills with distance | Yes | Yes | Yes |
| Markdown body | Yes | Yes | Yes |
| Elevation gain + conclusion | Yes | Yes | Yes |
| Difficulty ranking | No | Yes | Astro adds new feature |
| Route shape (loop/out-and-back) | No | Yes | Astro adds new feature |
| Place summary | No | Yes | Astro adds new feature |
| View Map button | Yes | Yes | Yes |
| Multiple variants | Yes | Yes | Yes |
| Strava/RWGPS links | Partial (Strava only) | Yes (both) | Astro adds RWGPS |
| Nearby places section | Yes | Yes | Yes |
| Place category grouping | Yes (grouped by parent category) | No (flat list by distance) | See finding |
| Schema.org microdata on places | Yes (Place, GeoCoordinates) | No | See finding |
| Photo gallery | Yes (score >= 1 filter) | Yes (score >= 1 filter with fallback) | Yes |
| Videos on route page | Yes | Yes | Yes |
| Similar routes | No | Yes | Astro adds new feature |
| "Go back" link | Yes | Yes | Yes |

**Minor: Place category grouping differs from Rails.** The Rails `NearbyPlaces` view groups places by `parent_category` and sorts by `[category, name]`, filtering to only `category.highlight?` categories. The Astro `NearbyPlaces.astro` shows a flat list sorted by distance. This is a reasonable UX choice but differs from production.

**Minor: Place Schema.org microdata is missing.** The Rails `NearbyPlaces` renders `itemscope itemtype="https://schema.org/Place"` with geo coordinates, address, phone, and URL properties. The Astro version does not include this structured data. For SEO parity, this should be added.

### Map Pages

| Feature | Rails | Astro | Match? |
|---|---|---|---|
| Full-screen Leaflet map | Yes | Yes | Yes |
| Route polyline | Yes | Yes | Yes |
| Place markers with emoji | Yes | Yes | Yes |
| Elevation profile | Yes | Yes | Yes |
| GPX download | Yes | Yes | Yes |
| GPX explore (gpx.studio) | No | Yes | Astro adds |
| PNG map download | No | Yes | Astro adds |
| Geolocation button | No | Yes | Astro adds |
| Per-variant maps | Yes | Yes | Yes |
| Thunderforest tiles | Yes | Yes | Yes, via config |

### Calendar

| Feature | Rails | Astro | Match? |
|---|---|---|---|
| Upcoming events grouped by month | Yes | Yes | Yes |
| Past events with toggle | Yes | Yes | Yes |
| Event card (organizer, name, dates, distances, poster) | Yes | Yes | Yes |
| Schema.org Event microdata | Yes (inline) | No | See finding |
| "Add to Apple Calendar" button | Yes | Replaced with iCal subscribe link | Different UX |
| "Add to Google Calendar" button | Yes | No | Missing |
| iCal feed | Yes | Yes | Yes |
| "That's a wrap" message | Yes | Yes | Yes |
| Review link | Yes | Yes | Yes |

**Important: Calendar event microdata is missing.** The Rails calendar renders `itemscope itemtype="https://schema.org/Event"` with name, dates, organizer, location, and attendance mode. The Astro calendar renders plain HTML with no structured data. This is an SEO regression for event pages.

**Minor: Google Calendar link is missing.** The Rails app has both "Add to Apple Calendar" (webcal://) and "Add to Google Calendar" links. The Astro app has a generic "Subscribe to iCal feed" link.

### Videos

| Feature | Rails | Astro | Match? |
|---|---|---|---|
| Videos grouped by route | Yes (grouped by ride) | Yes (grouped by route) | Yes |
| Video thumbnails | Yes | Yes | Yes |
| Individual video show pages | Yes | Yes | Yes |
| "Other videos" on show page | Yes (from same route) | Yes (from same route) | Yes |
| Video player (HLS, AV1, H264) | Yes | Yes | Yes |

### Guides

| Feature | Rails | Astro | Match? |
|---|---|---|---|
| Guide list | Yes | Yes | Yes |
| Guide detail with markdown | Yes | Yes | Yes |
| JSON-LD Article | Not in Rails | Yes | Astro adds |
| Breadcrumb JSON-LD | Not in Rails | Yes | Astro adds |

### SEO Comparison

| Element | Rails | Astro | Match? |
|---|---|---|---|
| `<title>` | Yes (customized per page type) | Yes (simpler format) | See finding |
| `<meta description>` | Yes | Yes | Yes |
| Open Graph (title, url, description, image) | Yes | Yes | Yes |
| Twitter cards | Yes | Yes | Yes |
| Canonical URL | Yes | Yes | Yes |
| JSON-LD BlogPosting (routes) | Yes | Yes | Yes |
| JSON-LD SportsEvent (events) | Not as JSON-LD (inline microdata) | Yes (JSON-LD) | Astro improves |
| JSON-LD Article (guides) | Not in Rails | Yes | Astro adds |
| JSON-LD BreadcrumbList | Not in Rails | Yes | Astro adds |
| JSON-LD TouristTrip | Neither | Neither | Spec says TouristTrip for routes |
| Sitemap XML | Yes | Yes | Yes |
| robots.txt | Yes | Yes | Yes |

**Minor: Route `<title>` format differs.** Rails: `"Route Name - tagline | Ottawa by Bike"` or `"Route Name - Scenic Bike Route | Ottawa by Bike"` (uses SEO-friendly tags). Astro: `"Route Name | Ottawa by Bike"`. The Rails version includes the tagline or a tag-based suffix in the title, which may perform better in search results.

**Minor: JSON-LD uses BlogPosting instead of TouristTrip.** The spec says routes should use TouristTrip schema type, but both the Rails app and the Astro app use BlogPosting. This is consistent but does not follow the spec recommendation.

---

## 4. Code Quality

### TypeScript Usage

**Good**: The codebase makes reasonable use of TypeScript. Interfaces are defined for key data structures (`GpxTrack`, `PlaceData`, `NearbyPlace`, `CityConfig`, `RouteElevationData`, `CategoryCount`). Component props have typed interfaces.

**Important: Heavy use of `any` type in the route loader and some pages.**

- `src/loaders/routes.ts` line 37: `let media: any[] = []`
- `src/loaders/routes.ts` line 41: `const gpxTracks: Record<string, any> = {}`
- `src/loaders/routes.ts` line 56-59: `store.set({ id: slug, data: { ...frontmatter, media, gpxTracks, renderedBody } })` -- the spread of untyped `frontmatter` bypasses the Zod schema at the store level
- `src/pages/routes/[slug]/map/[variant].astro` line 20: `const paths: any[] = []`
- `src/pages/videos/[handle].astro` line 12: `const paths: { params: { handle: string }; props: any }[] = []`

The route loader deserves the most attention here. Frontmatter is parsed by `gray-matter` which returns `Record<string, unknown>`, then spread into the store without validation. While Astro applies the Zod schema afterward, the loader itself could validate data more carefully.

**Recommendation**: Define a `RouteFrontmatter` TypeScript interface and use it in the loader. Replace `any` with proper types in variant map paths and video show paths.

### Error Handling

**Good**: GPX parsing has try/catch with logger warnings (`src/loaders/routes.ts` line 49). The loader gracefully handles missing directories, missing files, and missing GPX.

**Note**: The city config loader (`src/lib/city-config.ts`) will throw an unhandled error if `config.yml` is missing. Since this is a build-time-only file, this is acceptable -- a missing config means the data repo is not set up.

### Test Coverage

| Module | Has Tests? | Test File | Quality |
|---|---|---|---|
| Elevation (quantiles, tags, conclusion) | Yes | `tests/elevation.test.ts` | Good -- 10 tests covering edge cases |
| Route insights (difficulty, shape, place counts) | Yes | `tests/route-insights.test.ts` | Good -- covers ranking, shapes, grouping |
| Route similarity (lowres, similarity, matrix) | Yes | `tests/route-similarity.test.ts` | Good -- identity, disjoint, partial overlap |
| Proximity (findNearbyPlaces) | Yes | `tests/proximity.test.ts` | Minimal -- 2 tests, could use more edge cases |
| GPX parsing | Yes | `tests/gpx.test.ts` | Not reviewed in detail |
| Date utilities | Yes | `tests/date-utils.test.ts` | Not reviewed in detail |
| Distance formatting | Yes | `tests/distance-format.test.ts` | Not reviewed in detail |
| Image service | Yes | `tests/image-service.test.ts` | Not reviewed in detail |
| Video service | Yes | `tests/video-service.test.ts` | Not reviewed in detail |
| JSON-LD | Yes | `tests/json-ld.test.ts` | Not reviewed in detail |
| Map thumbnails | Yes | `tests/map-thumbnails.test.ts` | Not reviewed in detail |
| Sitemap | Yes | `tests/sitemap.test.ts` | Not reviewed in detail |
| E2E screenshots | Yes | `e2e/screenshots.spec.ts` | 8 page types |

**12 unit test files and 1 E2E test file.** This is solid coverage for the data processing and utility layers. All core computation modules (elevation, insights, similarity, proximity) are tested.

**What is NOT tested**:
- Component rendering (no component tests)
- Content loader behavior
- Redirect generation logic
- i18n module (`src/lib/i18n.ts`)
- Analytics module
- City config loading

This is acceptable for a Phase B build. The E2E screenshots provide confidence that pages render correctly.

### Build Performance

**Good decisions**:
- `build.concurrency: 4` in `astro.config.mjs` for parallel page generation
- Map thumbnail caching with GPX hash-based invalidation (`src/lib/map-thumbnails.ts`)
- Map cache persistence in CI via `actions/cache`
- Lazy loading for images beyond the first 5 route cards

**Note**: The proximity computation happens in `getStaticPaths` of the route detail page, which means it runs once for *all* route pages. The similarity matrix is also computed in `getStaticPaths`. This is the correct approach -- compute once, pass to all pages.

### Code Smells

**Minor: Duplicated place data mapping.** The following pattern appears in 3 files (`[slug].astro`, `map/index.astro`, `map/[variant].astro`):
```typescript
const placeData: PlaceData[] = allPlaces
  .filter(p => p.data.status === 'published')
  .map(p => ({ id: p.id, name: p.data.name, category: p.data.category, lat: p.data.lat, ... }));
```
This should be extracted into a shared utility function.

**Minor: Duplicated geolocation control code.** The GPS "Find my location" button implementation is duplicated verbatim between `LeafletMap.astro` and `BigMap.astro` (lines 96-116 in LeafletMap, lines 87-106 in BigMap). This should be extracted into a shared module.

**Note**: The `haversine` function was recently deduplicated (commit `073aa7f`), which shows awareness of this pattern.

---

## 5. Data Insights Implementation

### v1 Insights Checklist

| Insight | Spec Requirement | Status | Implementation | Tests? |
|---|---|---|---|---|
| Place-route proximity (300m) | Yes | Done | `src/lib/proximity.ts` -- @turf/nearest-point-on-line, 300m threshold | Yes |
| Similar routes (similarity matrix) | Yes | Done | `src/lib/route-similarity.ts` -- lowres point sets at precision 4, percentage overlap | Yes |
| Relative difficulty ranking | Yes | Done | `src/lib/route-insights.ts` `difficultyRanking` -- elevation gain per km | Yes |
| Route shape classification | Partial | See below | `src/lib/route-insights.ts` `routeShape` -- loop vs out-and-back only | Yes |
| Place summary per route | Yes | Done | `src/lib/route-insights.ts` `placeCounts` + `src/lib/i18n.ts` `tPlaceSummary` | Yes |
| Elevation tags (flat/elevation) | Yes | Done | `src/lib/elevation.ts` `elevationTags` -- 15th/85th percentile thresholds | Yes |

**Minor: Route shape classification is missing "point-to-point".** The spec lists three shape types: "loop vs out-and-back vs point-to-point (computed from start/end point proximity)." The implementation only distinguishes "loop" (start/end < 1km apart) from "out-and-back" (everything else). True point-to-point routes (where the end point is far from the start and the route doesn't retrace itself) are classified as "out-and-back."

Distinguishing these requires checking whether the middle section of the route overlaps with itself (out-and-back) vs follows a new path (point-to-point). This is a non-trivial algorithm and the current two-class system is a reasonable v1 simplification.

### Similarity Matrix Implementation

The similarity algorithm in `src/lib/route-similarity.ts` correctly replicates the Rails app's `Mapping::Signature` approach:
- Points rounded to precision 4 (~11m resolution)
- Percentage of shared lowres points
- Symmetric comparison

**Note**: The `buildSimilarityMatrix` function optimizes by pre-computing lowres sets, avoiding the O(n^2 * points) worst case. The function in `getStaticPaths` builds the matrix once and passes it to all route pages. This is efficient.

### Elevation Tag Implementation

The `src/lib/elevation.ts` correctly replicates the Rails `Statistics.elevation_tags` behavior:
- 15th percentile = "flat" tag
- 85th percentile = "elevation" tag
- Uses only published routes with positive elevation gain

The `elevationConclusion` function provides richer elevation descriptions (7 levels from "flat" to "very very hard") based on a more granular quantile scale. This matches the Rails `Statistics#conclusion_for_route` behavior.

---

## 6. Missing/Incomplete Items

### Explicitly in Phase B spec but not yet implemented:

1. **Golden tests** (Phase B.6) -- The spec defines this as the primary acceptance criteria: spider production, capture fixtures, assert equivalence. The E2E screenshot tests are a partial substitute but don't verify content-level parity (titles, meta tags, JSON-LD, link structure).

2. **Service adapter interfaces** (Phase B.1) -- No TypeScript interfaces for StorageService, ImageService, etc. Current implementations are direct concrete functions.

3. **Visible breadcrumb navigation** (Phase B.3) -- JSON-LD breadcrumbs exist but no visible breadcrumb trail in HTML.

4. **PlaceCard component** (Phase B.3) -- No standalone PlaceCard. Places are rendered inline in NearbyPlaces.

5. **Route loader incremental caching** (spec Architecture section) -- No use of Astro's `meta`/`digest` for GPX file change detection.

### Partially implemented:

1. **Route shape classification** -- Two types instead of three (missing "point-to-point").

2. **Calendar structured data** -- Events have JSON-LD SportsEvent in the `eventJsonLd` function but it is NOT used on the calendar page. Events on the calendar page have no structured data.

3. **SEO title optimization** -- Simpler format than Rails (missing tagline/tag suffix in route titles).

---

## 7. Risks and Concerns

### Production Deployment Risks

**Important: Hardcoded "Ottawa by Bike" text in the about page.**

`src/pages/about.astro` line 11 contains hardcoded text: `"Heyo Welcome to Ottawa by Bike!"` and the entire about page content is hardcoded in the template rather than coming from the data repo. The spec's multi-city architecture means this page should be data-driven, or at minimum use `config.display_name`. The greeting uses `config.display_name` is NOT used for the title text in the `<h1>`. The city config centralization commit (`7f61e22`) may have missed this page.

Other hardcoded references to check:
- `src/pages/about.astro` line 13: "Jose Albornoz" description -- uses `config.author.name` for the `<img>` alt text but the paragraph text is hardcoded
- `src/pages/about.astro` lines 17-23: The entire origin story is hardcoded

**Recommendation**: For multi-city support, the about page content should either come from the data repo (a markdown file) or use config values exclusively.

**Important: The `_redirects` file generation has a redundant existence check.**

`astro.config.mjs` lines 33-36:
```javascript
if (!fs.existsSync(redirectsPath)) return;
const data = fs.existsSync(redirectsPath)  // redundant check
  ? yaml.load(fs.readFileSync(redirectsPath, 'utf-8')) || {}
  : {};
```
The first check returns early if the file doesn't exist, making the ternary always take the `true` branch. Not a bug, but confusing.

**Note: iCal feed does not handle events with start times.**

The Rails app's iCal implementation (`WelcomeController#ical`) handles both all-day events (`DTSTART;VALUE=DATE`) and events with specific times (`DTSTART` as DateTime). The Astro `calendar.ics.ts` only generates `DTSTART;VALUE=DATE` regardless of whether the event has a `start_time`. If events with specific start times are added to the data, the iCal feed will lose time precision.

### SEO Regression Risks

1. **Missing event microdata on calendar page** -- Search engines may lose rich event snippets.
2. **Missing place microdata on route pages** -- Minor impact but technically a regression.
3. **Simpler route titles** -- May affect click-through rate from search results.
4. **No JSON-LD on calendar page** -- Events have a `eventJsonLd` function defined but never called on the calendar page.

### Performance Considerations

**Note**: All route polylines are serialized into HTML `data-` attributes on the big map page. For 28 routes, this is fine. For 100+ routes, the HTML payload of `/map` could become large. The spec mentions "pre-generate simplified GeoJSON at build time" as a mitigation. Currently, full-resolution encoded polylines are passed.

---

## 8. What Was Done Well

1. **City config centralization** (`src/lib/city-config.ts`): Clean pattern. CDN URL, tiles URL, map center, place categories, author info -- all from one YAML file. The commit `7f61e22` systematically removed hardcoded Ottawa references.

2. **i18n module** (`src/lib/i18n.ts`): Forward-looking design. All display strings for elevation descriptions, route shapes, and place summaries are in a locale-keyed structure. Adding French or another language is straightforward.

3. **Analytics implementation** (`src/lib/analytics.ts`): Comprehensive Plausible integration with custom events for gallery opens, tag filters, video plays, link clicks, social referrals, and repeat visits. The staging environment correctly disables analytics.

4. **CI/CD pipeline**: The `_build-and-deploy.yml` workflow is well-designed:
   - Separate data repo checkout
   - Map cache persistence
   - Auto-updating screenshot baselines with PR comments
   - Infinite loop guard on screenshot commits
   - Build validation in CI

5. **Photo gallery**: The PhotoSwipe integration with dynamic captions, object position, score-based filtering (matching Rails' `Gallery.from_photos` behavior), "show all" button, and cover photo click-to-open is polished.

6. **Data insights**: All six v1 insights are implemented, tested, and rendered on route pages. The similarity matrix is an efficient O(n^2) computation with pre-computed lowres sets. The elevation tags correctly match the Rails percentile-based approach.

7. **Font preload auto-detection**: `src/lib/fonts.ts` parses the SCSS webfonts file to find latin font URLs, avoiding manual preload list maintenance. This is a small but thoughtful detail.

8. **Makefile**: Clear, well-documented targets for common operations. Makes onboarding easy.

---

## 9. Recommendations Summary

### Before Launch (Important)

1. Run content-level parity check (golden tests or manual comparison) against production for key pages: homepage, 3 route detail pages, calendar, guides, videos, about. Verify `<title>`, `<meta description>`, canonical URL, and JSON-LD output.

2. Add JSON-LD structured data for calendar events (the `eventJsonLd` function exists but is not used on the calendar page).

3. Add Schema.org Place microdata to the NearbyPlaces component to maintain SEO parity with the Rails app.

4. Verify all 30 redirect handles are covered by testing the `_redirects` output against the exported `redirects.yml`.

5. Add `start_time` handling to the iCal feed before any timed events are added to the data.

### Post-Launch (Minor)

6. Add visible breadcrumb navigation to route and guide pages.

7. Extract duplicated place data mapping into a shared utility function.

8. Extract the geolocation control into a shared Leaflet plugin module.

9. Add route loader incremental caching using Astro's `meta`/`digest` APIs.

10. Define TypeScript interfaces for the image and video service contracts.

11. Replace `any` types in the route loader and page `getStaticPaths` with proper TypeScript types.

12. Consider including tagline or SEO-friendly tags in route page `<title>` elements to match Rails behavior.

13. Add "point-to-point" as a third route shape classification.

---

## Files Referenced in This Review

Core architecture:
- `/home/dev/code/bike-app-astro/astro.config.mjs`
- `/home/dev/code/bike-app-astro/src/content.config.ts`
- `/home/dev/code/bike-app-astro/src/schemas/index.ts`
- `/home/dev/code/bike-app-astro/src/loaders/routes.ts`
- `/home/dev/code/bike-app-astro/src/lib/config.ts`
- `/home/dev/code/bike-app-astro/src/lib/city-config.ts`

Data insights:
- `/home/dev/code/bike-app-astro/src/lib/proximity.ts`
- `/home/dev/code/bike-app-astro/src/lib/route-insights.ts`
- `/home/dev/code/bike-app-astro/src/lib/route-similarity.ts`
- `/home/dev/code/bike-app-astro/src/lib/elevation.ts`
- `/home/dev/code/bike-app-astro/src/lib/i18n.ts`

Services:
- `/home/dev/code/bike-app-astro/src/lib/image-service.ts`
- `/home/dev/code/bike-app-astro/src/lib/video-service.ts`
- `/home/dev/code/bike-app-astro/src/lib/analytics.ts`

Pages:
- `/home/dev/code/bike-app-astro/src/pages/index.astro`
- `/home/dev/code/bike-app-astro/src/pages/routes/[slug].astro`
- `/home/dev/code/bike-app-astro/src/pages/routes/[slug]/map/index.astro`
- `/home/dev/code/bike-app-astro/src/pages/routes/[slug]/map/[variant].astro`
- `/home/dev/code/bike-app-astro/src/pages/routes/[slug]/[variant].gpx.ts`
- `/home/dev/code/bike-app-astro/src/pages/calendar.astro`
- `/home/dev/code/bike-app-astro/src/pages/calendar.ics.ts`
- `/home/dev/code/bike-app-astro/src/pages/map.astro`
- `/home/dev/code/bike-app-astro/src/pages/about.astro`
- `/home/dev/code/bike-app-astro/src/pages/videos/index.astro`
- `/home/dev/code/bike-app-astro/src/pages/videos/[handle].astro`
- `/home/dev/code/bike-app-astro/src/pages/guides/index.astro`
- `/home/dev/code/bike-app-astro/src/pages/guides/[slug].astro`
- `/home/dev/code/bike-app-astro/src/pages/sitemap.astro`
- `/home/dev/code/bike-app-astro/src/pages/sitemap.xml.ts`
- `/home/dev/code/bike-app-astro/src/pages/rss.xml.ts`
- `/home/dev/code/bike-app-astro/src/pages/llms.txt.ts`
- `/home/dev/code/bike-app-astro/src/pages/robots.txt.ts`

Components:
- `/home/dev/code/bike-app-astro/src/components/SEO.astro`
- `/home/dev/code/bike-app-astro/src/components/RouteCard.astro`
- `/home/dev/code/bike-app-astro/src/components/LeafletMap.astro`
- `/home/dev/code/bike-app-astro/src/components/BigMap.astro`
- `/home/dev/code/bike-app-astro/src/components/PhotoGallery.astro`
- `/home/dev/code/bike-app-astro/src/components/ElevationProfile.astro`
- `/home/dev/code/bike-app-astro/src/components/EventCard.astro`
- `/home/dev/code/bike-app-astro/src/components/NearbyPlaces.astro`
- `/home/dev/code/bike-app-astro/src/components/TagFilter.astro`
- `/home/dev/code/bike-app-astro/src/components/MapPage.astro`
- `/home/dev/code/bike-app-astro/src/layouts/Base.astro`

Tests:
- `/home/dev/code/bike-app-astro/tests/elevation.test.ts`
- `/home/dev/code/bike-app-astro/tests/route-insights.test.ts`
- `/home/dev/code/bike-app-astro/tests/route-similarity.test.ts`
- `/home/dev/code/bike-app-astro/tests/proximity.test.ts`
- `/home/dev/code/bike-app-astro/e2e/screenshots.spec.ts`

CI/CD:
- `/home/dev/code/bike-app-astro/.github/workflows/ci.yml`
- `/home/dev/code/bike-app-astro/.github/workflows/_build-and-deploy.yml`

Scripts:
- `/home/dev/code/bike-app-astro/scripts/validate.ts`

Rails comparison files:
- `/home/dev/code/bike-app/app/views/routes/show.rb`
- `/home/dev/code/bike-app/app/views/routes/index.rb`
- `/home/dev/code/bike-app/app/views/places/nearby_places.rb`
- `/home/dev/code/bike-app/app/views/welcome/calendar.rb`
- `/home/dev/code/bike-app/app/views/videos/show.rb`
- `/home/dev/code/bike-app/app/models/sitemap/route_page.rb`

# Stats (`src/lib/stats/`)

Analytics data pipeline: Plausible API → sync layer → D1 tables → API endpoints → Preact islands.

## Data Pipeline — Strict Boundary

```
Plausible API → Sync Layer → D1 Tables → API Endpoints → Preact Islands
   (network)    (triggered)    (cached)    (D1 reads only)  (client-side)
```

**API endpoints NEVER call Plausible.** All Plausible data lives in D1. The sync layer is the only code with network access. This enables the develop-on-a-train principle — the dashboard works offline from fixture data.

## Files

| File | Role |
|------|------|
| `sync.server.ts` | Sync orchestration: `syncSiteMetrics`, `ensureSiteDailyData`, `ensurePageDailyData`, `ensureSiteEventData`, `ensureEntryPageData`. Batch upserts (50 rows/query). All Plausible queries parallelized |
| `sync-context.server.ts` | `buildSyncContext()` — shared context builder for API endpoints. Loads API key, city config, redirects from virtual module. Returns null when no API key (local dev) |
| `url-resolver.server.ts` | Maps Plausible URL paths to content identities `(contentType, contentSlug, pageType)`. Handles locale detection, path segment translation, slug aliases, redirects |
| `engagement.server.ts` | `rebuildEngagement()` — recomputes `content_engagement` summary table from `content_totals` + `reactions`. Percentile-ranked engagement score |
| `insights.ts` | Pure functions (browser-safe). Detects hidden gems, needs-work, strong performers. Minimum thresholds: 10 views, 30s duration |
| `narrative.ts` | Pure functions (browser-safe). Generates factual summary sentences for drill-down pages. States facts, never interprets intent |
| `types.ts` | Shared types (browser-safe): `ContentIdentity`, `TimeRange`, `InsightCard`, `ChartData`, `METRIC_DESCRIPTIONS` |
| `cache.server.ts` | `stats_cache` table read/write with 1-hour TTL |
| `seed-fixtures.server.ts` | Seeds D1 from `e2e/fixtures/plausible/*.json` when no API key (local dev) |

## Gotchas

### Redirects Must Come from Virtual Module

Route redirects (`16-the-big-loop` → `the-big-loop`) are loaded from `virtual:bike-app/route-redirects`, NOT from an API endpoint or ASSETS.fetch. The virtual module is baked into the server bundle at build time by `build-data-plugin.ts`. Previous attempts to load redirects via a prerendered JSON endpoint failed silently on CF Workers — `ASSETS.fetch` returned `{}`.

### Plausible Metric Order Matters

The Plausible API returns metrics in the order you request them. All queries use `['pageviews', 'visitors', 'visit_duration', 'bounce_rate']`. If you change the order, update `processPageBreakdown`, `processPageDaily`, and `processDailyAggregate` — they index `row.metrics[0]` etc. positionally.

### visit_duration Is TOTAL Seconds, Not Average

Plausible's `visit_duration` metric returns **total seconds** spent on a page on a given day, NOT the average per visit. The field is stored as `visitDurationS` in `content_daily_metrics` and `content_totals`. To get average per visit, divide by pageviews. Wall time = `SUM(visitDurationS) / 3600`, NOT `SUM(pageviews * visitDurationS) / 3600`.

### Aggregate Before Writing Totals

Multiple Plausible URL paths can resolve to the same content identity — e.g., `/routes/wakefield` and `/routes/wakefield/` both become `(route, wakefield, detail)`. The `syncSiteMetrics` function must aggregate `contentRows` by `(contentType, contentSlug, pageType)` BEFORE writing to `content_totals`. Without aggregation, the last row wins and earlier rows' pageviews are lost, causing wildly wrong ratios (map conversion showing 100% when the real ratio is 20%).

### Map Conversion Rate Must Be Capped

The engagement rebuild computes `mapConversionRate = mapViews / detailViews` from `content_totals`. Always cap at `Math.min(ratio, 1.0)` as a safety net.

### Batch All D1 Inserts

D1 on CF Workers has ~30-50ms latency per query. Row-by-row inserts of 300 rows = 9-15 seconds. Batch into chunks of 50 using raw SQL `INSERT ... VALUES (...),(...) ON CONFLICT DO UPDATE`. The `upsertContentRows`, `upsertTotalsRows`, `upsertDailyRows`, and `upsertEventRows` functions implement this.

### Incremental Sync (Nix-like)

Each `ensure*` function checks which dates already exist in D1 for the requested range, finds gaps, groups them into contiguous ranges, and fetches only the missing data from Plausible. Multiple missing ranges are fetched in parallel.

### Narrative Voice

The narrative module states facts and provides context. Never interpret visitor intent ("planning behavior", "sticky content", "strong signal"). A test enforces this — `expect(allText).not.toContain('planning')`.

### Force Sync Clears Everything

When the user presses "Sync now" (POST), the overview API deletes ALL analytics data for the city (all five tables), then rebuilds with `full: true` from 2020. This ensures stale data from previous syncs (wrong metric order, missing redirects) is purged.

## Tables

| Table | Purpose | PK |
|-------|---------|-----|
| `content_daily_metrics` | Daily per-content-item per-page-type metrics from Plausible (for charts) | `(city, content_type, content_slug, page_type, date)` |
| `content_totals` | All-time aggregates per content item per page type (for engagement scoring, funnel) | `(city, content_type, content_slug, page_type)` |
| `content_engagement` | Computed summary per content item (rebuilt from `content_totals` + reactions) | `(city, content_type, content_slug)` |
| `site_daily_metrics` | Site-wide daily aggregates from Plausible | `(city, date)` |
| `site_event_metrics` | Custom event breakdowns (repeat visits, social referrals) | `(city, event_name, date, dimension_value)` |
| `stats_cache` | Generic JSON cache with TTL | `(city, cache_key)` |

## Re-recording Fixtures

```sh
make record-plausible  # reads PLAUSIBLE_API_KEY from .env
```

Records all Plausible API responses to `e2e/fixtures/plausible/*.json`. The full-history fixture captures old numbered-slug URLs for redirect testing.

## Cross-References

- `src/views/api/admin-stats-*.ts` — API endpoints that call sync functions and query D1
- `src/components/admin/StatsOverview.tsx` — Overview Preact island
- `src/components/admin/StatsDetail.tsx` — Drill-down Preact island
- `src/db/schema.ts` — Table definitions
- `src/build-data-plugin.ts` — `route-redirects` virtual module
- `e2e/admin/stats.spec.ts` — E2E tests
- `tests/stats/` — Unit tests

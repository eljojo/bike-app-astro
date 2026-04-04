# Stats (`src/lib/stats/`)

Analytics data pipeline: Plausible API sync, engagement scoring, insights, narrative summaries.

## Files

| File | Role |
|------|------|
| `sync.server.ts` | Sync orchestration: `syncSiteMetrics`, `ensureSiteDailyData`, `ensurePageDailyData`, `ensureSiteEventData`, `ensureEntryPageData` |
| `sync-context.server.ts` | `buildSyncContext()` — shared context for API endpoints |
| `url-resolver.server.ts` | Maps Plausible URL paths to content identities `(contentType, contentSlug, pageType)` |
| `engagement.server.ts` | `rebuildEngagement()` — recomputes `content_engagement` from `content_totals` + reactions |
| `insights.ts` | Pure functions (browser-safe). Hidden gems, needs-work, strong performers |
| `narrative.ts` | Pure functions (browser-safe). Factual summary sentences — never interpret intent |
| `types.ts` | Shared types (browser-safe): `ContentIdentity`, `TimeRange`, `InsightCard`, `ChartData` |
| `cache.server.ts` | `stats_cache` table read/write with 1-hour TTL |
| `seed-fixtures.server.ts` | Seeds D1 from fixture JSON when no API key |

## Gotchas

- **API endpoints NEVER call Plausible.** All data lives in D1. Sync is the only code with network access.
- **Redirects come from virtual module** (`virtual:bike-app/route-redirects`), NOT from ASSETS.fetch (fails silently on CF Workers).
- **Plausible metric order matters** — queries use positional indexing (`row.metrics[0]`). Changing order requires updating all processors.
- **`visit_duration` has different semantics**: site-wide = average per visit; per-page = total seconds.
- **Aggregate before writing totals** — multiple URL paths can resolve to the same content identity.
- **Narrative voice**: states facts, never interprets intent. A test enforces this.
- **Force sync clears all analytics data** then rebuilds from 2020.

## Detailed Context

- [Content model](../../../_ctx/content-model.md)

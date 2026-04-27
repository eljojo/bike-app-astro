# External Services (`src/lib/external/`)

Vendor-isolated wrappers for third-party integrations. Each file encapsulates all API calls to one service.

## Files

| File | Role |
|------|------|
| `strava-api.ts` | Strava API: OAuth, activity/stream/photo fetching, GPX building |
| `strava-token-provider.ts` | D1-stored tokens with automatic refresh |
| `email.ts` | `createEmailService()` — local (console.log) or SES (AWS SigV4, no SDK) |
| `google-maps.ts` | Google My Maps KML import |
| `analytics.ts` | Client-side Plausible analytics (browser module) |
| `google-directions.ts` | Google Directions URL parser (browser-safe) |
| `url-resolve.server.ts` | Shortened URL resolver (server-only) |
| `routing.ts` | Routing service interface (browser-safe) |
| `routing.server.ts` | `createRoutingService()` factory (server-only) |
| `routing.adapter-google.server.ts` | Google Directions API adapter (server-only) |
| `open-meteo.server.ts` | Open-Meteo weather API (server-only) |
| `ics-feed.server.ts` | ICS/iCal feed fetch (5s timeout) + `parseIcs` via `ical.js`, mapping to `ParsedFeed`/`ParsedVEvent`/`ParsedSeries` (server-only) |

## Gotchas

- **`analytics.ts` is client-side** — runs in the browser. Do not import server-only modules.
- **SES uses raw HTTP with SigV4** — no AWS SDK. Uses Web Crypto API for Cloudflare Workers compatibility.
- **Strava token refresh is automatic** — refreshed tokens are persisted to D1.

## Detailed Context

- [Vendor isolation](../../../_ctx/vendor-isolation.md)

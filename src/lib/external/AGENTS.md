# External Services (`src/lib/external/`)

Vendor-isolated wrappers for third-party service integrations. Each file encapsulates all API calls to a single external service. No application code should call these APIs directly — always go through these wrappers.

## Files

| File | Role |
|------|------|
| `strava-api.ts` | Strava API wrapper: OAuth flow, activity/stream/photo fetching, GPX building from Strava streams. Exports `StravaTokenProvider` interface |
| `strava-token-provider.ts` | Creates a `StravaTokenProvider` from D1-stored tokens with automatic refresh |
| `email.ts` | Email service: `createEmailService()` returns local (console.log) or SES adapter. SES uses AWS SigV4 signing via Web Crypto API (no SDK dependency) |
| `google-maps.ts` | Google My Maps KML import: parses My Maps URLs, fetches KML, extracts route points |
| `analytics.ts` | Client-side Plausible analytics: tracks pageviews, link clicks, video plays, social referrals, repeat visits. Runs in the browser |
| `google-directions.ts` | Google Directions URL parser: extracts waypoints, shaping points, and travel mode from `/maps/dir/` URLs. Browser-safe (no API calls) |
| `url-resolve.server.ts` | Shortened URL resolver: follows redirects (up to 3 hops) for `maps.app.goo.gl` and similar shorteners. Server-only |
| `routing.ts` | `RoutingWaypoint`, `RoutingService`, `RoutingResult` types — browser-safe interface for vendor-isolated routing |
| `routing.server.ts` | `createRoutingService()` factory — currently returns Google adapter. Server-only |
| `routing.adapter-google.server.ts` | Google Directions API adapter: calls `directions/json`, decodes step-level polylines, converts `lng` → `lon`. Server-only |

## Gotchas

- **`analytics.ts` is a client-side module** — it runs in the browser, not on the server. It's bundled as an ES module script. Do not import server-only modules here.
- **SES uses raw HTTP with SigV4** — no AWS SDK dependency. The signing uses Web Crypto API so it works in Cloudflare Workers. If you need to debug SES, check the signature calculation chain.
- **Strava token refresh is automatic** — the `StravaTokenProvider` checks expiry and refreshes tokens before returning them. Refreshed tokens are persisted to D1.
- **`RIDE_SPORT_TYPES`** in strava-api.ts filters activities to cycling types only (Ride, EBikeRide, VirtualRide, GravelRide).

## Cross-References

- `auth/` — Strava OAuth endpoints live in `src/views/api/auth/`
- `config/app-env.ts` — SES and Strava credentials defined in `AppEnv`
- `env/env.service.ts` — provides the runtime env that email and Strava services need

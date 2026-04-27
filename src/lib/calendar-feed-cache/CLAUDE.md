# Calendar Feed Cache (`src/lib/calendar-feed-cache/`)

Hot cache of parsed upstream ICS feeds for the admin calendar-suggestions feature.
KV-shaped: opaque JSON value keyed by organizer slug, per-entry TTL.

## Files

| File | Role |
|------|------|
| `feed-cache.service.ts` | `CalendarFeedCache` interface: `get(slug, expectedSourceUrl)` and `put(slug, sourceUrl, feed, ttlSeconds)` |
| `feed-cache.adapter-kv.ts` | Cloudflare KV adapter — reuses the `TILE_CACHE` binding with a `calfeed:feed:v3:` key prefix |
| `feed-cache.adapter-local.ts` | Local filesystem adapter — `.data/calendar-feed-cache/` with JSON + sidecar `.meta` |

## Gotchas

- **Binding reuse.** The KV adapter binds to `TILE_CACHE`, not a dedicated binding. Distinct key prefix (`calfeed:feed:v3:`) prevents collisions with tile entries.
- **Source-URL carried in the value**, not just the key. If an organizer repoints their `ics_url`, the next `get` detects the mismatch and returns null — the stale entry TTL-expires rather than polluting the new URL's reads.
- **Adapter selection happens in `env/env.service.ts`**, not here.

## Detailed Context

- [Vendor isolation](../../../_ctx/vendor-isolation.md)

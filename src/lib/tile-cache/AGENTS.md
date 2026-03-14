# Tile Cache (`src/lib/tile-cache/`)

Map tile caching with an adapter pattern. Tiles fetched from upstream tile servers are cached to reduce latency and API costs. Two adapters implement the same `TileCache` interface.

## Files

| File | Role |
|------|------|
| `tile-cache.service.ts` | `TileCache` interface: `get(key)` and `put(key, data, ttlSeconds)` |
| `tile-cache.adapter-kv.ts` | Cloudflare KV adapter — prefixes keys with `tile:`, uses KV `expirationTtl` |
| `tile-cache.adapter-local.ts` | Local filesystem adapter — stores tiles as files in `.data/tile-cache/` |

## Gotchas

- **Adapter selection happens in `env/env.service.ts`**, not here. The `tileCache` export from env.service is pre-configured.
- The KV adapter converts `Uint8Array` to `ArrayBuffer` before storing, because KV `put` requires `ArrayBuffer`.
- Keys are prefixed with `tile:` in KV to avoid collision with other KV uses.

## Cross-References

- `env/env.service.ts` — creates and exports the tile cache instance
- `tile-proxy-helpers.ts` (root) — validates tile proxy URLs before caching

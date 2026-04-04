# Tile Cache (`src/lib/tile-cache/`)

Map tile caching with an adapter pattern.

## Files

| File | Role |
|------|------|
| `tile-cache.service.ts` | `TileCache` interface: `get(key)` and `put(key, data, ttlSeconds)` |
| `tile-cache.adapter-kv.ts` | Cloudflare KV adapter — prefixes keys with `tile:` |
| `tile-cache.adapter-local.ts` | Local filesystem adapter — `.data/tile-cache/` |

## Gotchas

- **Adapter selection happens in `env/env.service.ts`**, not here.
- KV adapter converts `Uint8Array` to `ArrayBuffer` before storing.
- Keys prefixed with `tile:` in KV to avoid collisions.

## Detailed Context

- [Vendor isolation](../../../_ctx/vendor-isolation.md)

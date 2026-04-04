# Config (`src/lib/config/`)

Build-time configuration and city-specific settings.

## Files

| File | Role |
|------|------|
| `config.ts` | Exports `CITY`, `VIDEO_PREFIX` from `process.env` (browser-safe) |
| `config.server.ts` | Exports `CONTENT_DIR`, `cityDir` (uses `node:path`, server-only) |
| `city-config.ts` | `getCityConfig()` — reads `config.yml`. Exports `isBlogInstance()`, `isClubInstance()` |
| `instance-features.ts` | `getInstanceFeatures()` — semantic booleans (`hasRoutes`, `hasRides`, `hasEvents`, etc.) |
| `app-env.ts` | `AppEnv` interface — unified env shape for Cloudflare and local runtimes |

## Gotchas

- **Build-time transform**: `city-config.ts` is replaced with static JSON by `build-data-plugin.ts`. If you change its exports, update the transform.
- **Never hardcode city/locale values.** Import `CITY` from `config.ts`. Check city config for locales.
- **Feature flags vs identity checks**: use `getInstanceFeatures()` for capability checks. Reserve `isBlogInstance()`/`isClubInstance()` for structural decisions only.

## Detailed Context

- [Config layers](../../../_ctx/config-layers.md)

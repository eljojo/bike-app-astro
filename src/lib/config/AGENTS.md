# Config (`src/lib/config/`)

Build-time configuration and city-specific settings. These modules are evaluated at build/startup time and cached — they read from `process.env` and the city's `config.yml` file.

## Files

| File | Role |
|------|------|
| `config.ts` | Exports `CITY`, `VIDEO_PREFIX` from `process.env` |
| `config.server.ts` | Exports `CONTENT_DIR`, `cityDir` (uses `node:path`). Server-only |
| `city-config.ts` | `getCityConfig()` — reads and caches `{cityDir}/config.yml`. Exports `isBlogInstance()`, `isClubInstance()`. Derives defaults (URL, CDN, plausible domain) from `domain` field |
| `instance-features.ts` | `getInstanceFeatures()` — returns `InstanceFeatures` with semantic booleans (`hasRoutes`, `hasRides`, `hasEvents`, `allowsRegistration`, etc.) based on instance type |
| `app-env.ts` | `AppEnv` interface — the unified env shape for both Cloudflare and local runtimes. Defines all runtime bindings (DB, BUCKET, tokens, API keys) |

## Gotchas

- **Build-time transform**: `city-config.ts` uses `fs.readFileSync` at build time but is replaced with static JSON by `build-data-plugin.ts`. If you change its exports, update the transform too.
- **`config.ts` vs `config.server.ts` vs `city-config.ts`**: `config.ts` is browser-safe env vars (`CITY`, `VIDEO_PREFIX`). `config.server.ts` adds filesystem paths (`CONTENT_DIR`, `cityDir`) using `node:path`. `city-config.ts` reads YAML and provides domain-specific settings.
- **Never hardcode city/locale values.** Import `CITY` from `config.ts`. Check city config for locales.
- **Feature flags vs identity checks**: use `getInstanceFeatures()` for capability checks. Reserve `isBlogInstance()`/`isClubInstance()` for structural decisions (which loaders/routes to register).
- **`AppEnv` is the single source of truth** for env shape. Both `env.service.ts` and `env.adapter-local.ts` must satisfy it.

## Cross-References

- `env/env.service.ts` — runtime complement to build-time config
- `env/env.adapter-local.ts` — creates a local `AppEnv` from process.env
- `src/build-data-plugin.ts` — replaces `city-config.ts` at build time

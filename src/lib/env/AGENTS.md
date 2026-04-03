# Environment (`src/lib/env/`)

Runtime environment resolution and Astro adapter selection. Primary vendor isolation boundary.

## Files

| File | Role |
|------|------|
| `env.service.ts` | Exports `env` (AppEnv), `tileCache`, `openLocalDb`, `localDbPath`. **Only file that imports `cloudflare:workers`** |
| `env.adapter-local.ts` | `createLocalEnv()` — builds `AppEnv` with local implementations (better-sqlite3, filesystem) |
| `adapter.ts` | `getAdapter()` — returns `@astrojs/node` or `@astrojs/cloudflare` |

## Gotchas

- **Top-level `await import()`**: `env.service.ts` uses conditional dynamic imports. `cloudflare:workers` is tree-shaken when `RUNTIME=local`.
- **Local DB path** uses `import.meta.dirname`, not `path.resolve()`.
- **`openLocalDb`** is only populated in local mode — used by `get-db.ts` for per-call DB connections (Playwright visibility).

## Detailed Context

- [Vendor isolation](../../../_ctx/vendor-isolation.md)

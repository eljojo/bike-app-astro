# Environment (`src/lib/env/`)

Runtime environment resolution and Astro adapter selection. This is the primary vendor isolation boundary — the single place where platform-specific imports (`cloudflare:workers`, `@astrojs/node`, `@astrojs/cloudflare`) are allowed.

## Files

| File | Role |
|------|------|
| `env.service.ts` | Exports `env` (AppEnv), `tileCache`, `openLocalDb`, `localDbPath`. Imports `cloudflare:workers` in production or `env.adapter-local.ts` locally. **This is the ONLY file that imports `cloudflare:workers`** |
| `env.adapter-local.ts` | `createLocalEnv()` — builds an `AppEnv` using local implementations: `better-sqlite3` DB, filesystem bucket, filesystem tile cache. Reads env vars for optional overrides |
| `adapter.ts` | `getAdapter()` — returns `@astrojs/node` (local) or `@astrojs/cloudflare` (production). Called by `astro.config.mjs` |

## Gotchas

- **Top-level `await import()`**: `env.service.ts` uses top-level conditional dynamic imports. The `cloudflare:workers` import is tree-shaken when `RUNTIME=local` and vice versa.
- **`astro.config.mjs` marks `cloudflare:workers` as external** when `RUNTIME=local` to prevent Rollup resolution errors.
- **Local DB path resolution** uses `import.meta.dirname`, not `path.resolve()` — this is critical for consistent paths across different working directories.
- **The `openLocalDb` export** is only populated in local mode. It's used by `get-db.ts` to create fresh DB connections per call (required for Playwright cross-process visibility).

## Cross-References

- `config/app-env.ts` — defines the `AppEnv` interface that both adapters must satisfy
- `get-db.ts` (root) — uses `openLocalDb` for local dev, `env.DB` for production
- `tile-cache/` — tile cache adapter is created here and exported
- `media/storage.adapter-local.ts` — local bucket created by `env.adapter-local.ts`

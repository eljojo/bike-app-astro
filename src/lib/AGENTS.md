# Core Library

## Vendor Isolation

Platform-specific imports are ONLY allowed in these boundary files:
- `env.ts` — `cloudflare:workers` (production) or `env-local.ts` (local)
- `adapter.ts` — `@astrojs/node` or `@astrojs/cloudflare`
- `git-factory.ts` — creates `LocalGitService` or `GitService` based on RUNTIME
- `get-db.ts` — `better-sqlite3` (local) or D1 (production)
- `storage-local.ts` — filesystem bucket for local dev

No other file in the codebase may import platform modules directly.

## Build-Time Transforms

Three files here use `fs.readFileSync` in Node.js but get **completely replaced** during the Vite build by `src/build-data-plugin.ts`:
- `city-config.ts` — replaced with static JSON from config.yml
- `tag-translations.ts` — replaced with static translation map
- `fonts.ts` — replaced with static font preload URLs

If you change the exports of these files, you MUST also update the transform in `build-data-plugin.ts`.

## Config Layers — Don't Confuse Them

- **Build-time** (`config.ts`): reads `process.env` at module evaluation. `CONTENT_DIR`, `CITY`, `cityDir`, `SITE_URL`, `CONTACT_EMAIL`, `CDN_FALLBACK_URL`.
- **Runtime** (`env.ts`): reads Cloudflare bindings or local env at request time. `GITHUB_TOKEN`, `GIT_OWNER`, `GIT_DATA_REPO`, `DB`, `BUCKET`, etc. via `AppEnv`.

## Key Function Signatures

- `authorize()` in `authorize.ts` returns `SessionUser | Response` (401/403) — NOT a boolean. For boolean UI-level checks, use `can()`.
- `withBatch()` in `db/transaction.ts` collects unawaited query builders. Do NOT await inside the callback — it executes prematurely instead of batching.

## CSP

When adding external domains or inline scripts, update `csp.ts`. For SSR pages, use `is:inline nonce={cspNonce}`. For static pages (prerender=true), use bare `<script>` tags — Astro hashes them. Never use `is:inline` on static pages.

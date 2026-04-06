---
description: Build-time vs runtime config, city config YAML, AppEnv, build-time transforms
type: knowledge
triggers: [adding configuration, reading env vars, accessing city config, changing build-time constants, working with Cloudflare bindings]
related: [instance-types, architecture-principles]
---

# Configuration Layers

Two distinct layers — don't confuse them.

## Build-Time Config

**Files:** `src/lib/config/config.ts` (browser-safe) + `src/lib/config/config.server.ts` (server-only).

- `config.ts` exports `CITY` and `VIDEO_PREFIX` — safe to import from Preact components.
- `config.server.ts` exports `CONTENT_DIR` and `cityDir` — uses `node:path`, server-only.

These read `process.env` at module evaluation time. Values are frozen into the build.

## Runtime Config (AppEnv)

**File:** `src/lib/env/env.service.ts`

Reads Cloudflare bindings (production) or local env vars (dev) at request time. Provides `AppEnv` with:

- `GITHUB_TOKEN`, `GIT_OWNER`, `GIT_DATA_REPO` — git operations
- `DB` — D1 database binding
- `BUCKET` — R2 storage binding
- Other service credentials

Runtime config is only available in server-rendered (SSR) pages and API endpoints. Static pages cannot access it.

## City Config

**Source:** `{CONTENT_DIR}/{CITY}/config.yml`

Defines per-city settings: display name, CDN URLs, tile server, timezone, locales, map bounds, place categories, analytics domain, author info. Locales are derived from city config, never hardcoded.

At build time, `src/build-data-plugin.ts` replaces `src/lib/config/city-config.ts` with static JSON from this YAML file.

## Build-Time Transforms

Three files use `fs.readFileSync` at dev time but get completely replaced during the Vite build by `src/build-data-plugin.ts`:

- `config/city-config.ts` — replaced with static JSON from config.yml
- `i18n/tag-translations.server.ts` — replaced with static translation map
- `fonts.server.ts` — replaced with static font preload URLs

If you change the exports of these files, you MUST also update the transform in `build-data-plugin.ts`.

## Fail Loud on Missing Config

Never silently fall back when required env vars or config values are missing. Use explicit checks that throw with a clear message naming the missing value and where to set it. See `requireEnv()` in `csp-env.ts` for the pattern.

The only acceptable silent fallback is during Astro prerendering, where runtime env (Cloudflare bindings) is genuinely unavailable. Guard those paths with an explicit `null` return and a comment explaining why.

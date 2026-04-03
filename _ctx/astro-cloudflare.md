---
description: Wrangler config patching, middleware exclusions, incremental cache versioning, import.meta.dirname, renderer stripping
type: gotcha
triggers: [modifying wrangler config, adding middleware exclusions, changing admin model shape, using path resolution, debugging NoMatchingRenderer]
related: [platform-gotchas]
---

# Astro + Cloudflare Gotchas

## Wrangler Config — No `main` Field in Source

`wrangler.jsonc` must NOT have a `main` field in the source file. CI patches it post-build to point at the Astro-generated worker entry. Adding `main` to the source file breaks the build.

## Middleware Auth Exclusions

`/api/auth/*` and `/api/reactions/*` skip auth middleware. When adding new public endpoints, add them to the `isProtected` check in `src/middleware.ts`.

## Incremental Build Cache Versioning

Two layers of caching: persistent content cache (`.astro/cache/admin-{rides,routes}-cache.json`) and build plan (`.astro/cache/build-plan.json`). Safe by default — new pages always rebuild. Only pages calling `filterByBuildPlan()` get incremental filtering.

Full build triggers: code changes, package updates, no previous manifest, >50% content changed, `FORCE_FULL_BUILD=1`.

If you change the shape of `AdminRide`, `AdminRideDetail`, `AdminRoute`, or `RouteDetail`, bump `RIDE_CACHE_VERSION` or `ROUTE_CACHE_VERSION` in the corresponding admin loader. Stale caches with mismatched shapes cause silent data bugs.

## Path Resolution — Use import.meta.dirname

Never use `path.resolve('relative/path')` — the CWD in Cloudflare Workers is not what you expect. Use `import.meta.dirname` instead, which resolves relative to the current file.

## Map Markers — HTML Only

Never use default MapLibre markers. Use CSS-styled HTML markers instead. Default markers depend on canvas rendering that behaves inconsistently in Workers.

## Prerender Flags

Every page and API endpoint MUST export `prerender` (true or false). Astro uses this to determine build strategy. Missing flags cause unpredictable behavior.

## No Client-Side Navigation

The site uses full page loads, not `<ClientRouter />`. Use `DOMContentLoaded` for client-side init, not `astro:page-load`.

## Astro 6 Renderer Stripping

Astro 6 strips renderers (e.g., Preact) from the SSR bundle when it thinks all pages are prerendered. The check only counts routes with `origin:"project"` — routes from `injectRoute()` get `origin:"external"` and are invisible.

Since this project uses `injectRoute()` for ALL routes, Astro strips all renderers, and every SSR page with a Preact island fails with `NoMatchingRenderer`.

**Fix:** `scripts/patch-astro-renderers.js` runs as a postinstall script and disables the optimization. If Astro fixes the bug upstream, the patch detects the change and exits cleanly.

## Zod v4

Import from `zod/v4`, not `zod` or `astro/zod`. Key v4 differences:

- `z.record(z.string(), z.unknown())` (not single-arg)
- `z.looseObject()` (not `.passthrough()`)

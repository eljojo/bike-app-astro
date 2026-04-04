# Astro Integrations

## No Bracket Filenames

NEVER create files with `[` or `]` in names. Dynamic routes use `injectRoute()` here. View files live in `src/views/` with plain names.

## Route Ordering

Static routes MUST precede parameterized routes when they share a prefix.

## i18n Sync Requirement

Route patterns in `i18n-routes.ts` and the segment map in `src/lib/i18n/segment-registry.ts` MUST stay in sync.

## Astro 6 Renderer Stripping

Astro 6 strips renderers when it thinks all pages are prerendered. Since this project uses `injectRoute()` for ALL routes, Astro sees zero project routes and strips Preact. **Fix:** `scripts/patch-astro-renderers.js` runs as postinstall.

## Detailed Context

- [i18n system](../../_ctx/i18n.md)
- [Astro & Cloudflare gotchas](../../_ctx/astro-cloudflare.md)

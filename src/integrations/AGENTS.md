# Astro Integrations

## No Bracket Filenames

NEVER create files with `[` or `]` in names. Dynamic routes use `injectRoute()` here. View files live in `src/views/` with plain names.

## Route Ordering

Static routes MUST precede parameterized routes when they share a prefix. Example: `/api/reactions/route/_starred` must come before `/api/reactions/[contentType]/[contentSlug]`.

## i18n Sync Requirement

`localePages` in `i18n-routes.ts` and `segmentTranslations` in `src/lib/i18n/path-translations.ts` MUST stay in sync. Adding a route to `localePages` without a translation entry means the French URL uses the English segment.

## Astro 6 Renderer Stripping (Postinstall Patch)

Astro 6 has a build optimization that strips renderers (e.g. Preact) from the SSR bundle when it thinks all pages are prerendered. The check (`hasNonPrerenderedProjectRoute`) only counts routes with `origin:"project"` — i.e. file-based routes in `src/pages/`. Routes from `injectRoute()` get `origin:"external"` and are invisible to this check.

Since this project uses `injectRoute()` for ALL routes (per the No Bracket Filenames rule), Astro sees zero project routes, strips all renderers, and every SSR page with a Preact island fails with `NoMatchingRenderer`.

**Fix:** `scripts/patch-astro-renderers.js` runs as a postinstall script and disables the optimization. If Astro fixes the bug upstream, the patch detects the change and exits cleanly.

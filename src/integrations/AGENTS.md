# Astro Integrations

## No Bracket Filenames

NEVER create files with `[` or `]` in names. Dynamic routes use `injectRoute()` here. View files live in `src/views/` with plain names.

## Route Ordering

Static routes MUST precede parameterized routes when they share a prefix. Example: `/api/reactions/route/_starred` must come before `/api/reactions/[contentType]/[contentSlug]`.

## i18n Sync Requirement

`localePages` in `i18n-routes.ts` and `segmentTranslations` in `src/lib/i18n/path-translations.ts` MUST stay in sync. Adding a route to `localePages` without a translation entry means the French URL uses the English segment.

# i18n (`src/lib/i18n/`)

Locale utilities, URL path translations, and content tag translations. Locales are derived from the city's `config.yml` (e.g., `[en-CA, fr-CA]` becomes `[en, fr]`), never hardcoded.

## Files

| File | Role |
|------|------|
| `locale-utils.ts` | `shortLocale()`, `fullLocale()`, `defaultLocale()`, `supportedLocales()`, `localeLabel()` — locale string conversion and city-aware locale queries |
| `path-translations.ts` | URL path segment translations: `translatePath()` and `reverseTranslatePath()`. Segment map is initialized by `setSegmentTranslations()` during `astro:config:setup`. Also exports `buildSegmentTranslations()` for the i18n-routes integration |
| `tag-translations.ts` | `tTag()` — translates route tags (e.g., "riverside" to "riviere") using `{cityDir}/tag-translations.yml`. Build-time transformed by `build-data-plugin.ts` |
| `locale-switcher.ts` | `switchLocalePath()` — computes the URL for switching between locales. Handles reverse-translating segments from current locale, then translating to target locale. Uses `alternateUrl` when available (for pages with translated slugs) |

## Gotchas

- **Build-time transform**: `tag-translations.ts` reads from YAML at build time but is replaced with a static map by `build-data-plugin.ts`. If you change its exports, update the transform.
- **Segment translations are initialized at startup**, not at import time. `setSegmentTranslations()` is called by the i18n-routes integration during `astro:config:setup`. Before that call, `translatePath` and `reverseTranslatePath` are no-ops.
- **`defaultLocale()` returns the short locale** (e.g., `"en"`, not `"en-CA"`). Use `fullLocale()` when you need the full BCP47 tag for `Intl` formatting.
- **Segment translations are colocated with route definitions** in `src/integrations/i18n-routes.ts`, not in this directory. `buildSegmentTranslations()` collects them into the translation map.

## Cross-References

- `src/integrations/i18n-routes.ts` — defines locale pages with segment translations, calls `setSegmentTranslations()`
- `src/i18n/` — UI string translations (`en.json`, `fr.json`, `es.json`) and the `t()` helper
- `config/city-config.ts` — locale list comes from city config

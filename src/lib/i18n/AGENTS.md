# i18n (`src/lib/i18n/`)

Locale utilities, URL path translations, and content tag translations. Locales are derived from the city's `config.yml` (e.g., `[en-CA, fr-CA]` becomes `[en, fr]`), never hardcoded.

## Files

| File | Role |
|------|------|
| `locale-utils.ts` | `shortLocale()`, `fullLocale()`, `defaultLocale()`, `supportedLocales()`, `localeLabel()` — locale string conversion and city-aware locale queries |
| `path-translations.ts` | URL path segment translations: `translatePath()` and `reverseTranslatePath()`. Reads from the static segment map in `segment-registry.ts` |
| `segment-registry.ts` | Static map of URL path segment translations (e.g., `calendar` → `calendrier` for French). When adding a new route with translated segments, add the segment here |
| `tag-translations.ts` | `tTag()` — translates route tags (e.g., "riverside" to "riviere") using `{cityDir}/tag-translations.yml`. Build-time transformed by `build-data-plugin.ts` |
| `locale-switcher.ts` | `switchLocalePath()` — computes the URL for switching between locales. Handles reverse-translating segments from current locale, then translating to target locale. Uses `alternateUrl` when available (for pages with translated slugs) |

## Gotchas

- **Build-time transform**: `tag-translations.ts` reads from YAML at build time but is replaced with a static map by `build-data-plugin.ts`. If you change its exports, update the transform.
- **Segment translations are a static constant** in `segment-registry.ts`, NOT a mutable variable set at runtime. Vite's SSR bundle runs in a separate module graph from Astro integration hooks, so module-level mutable state set during `astro:config:setup` would not be available at render time. This is why the translations are defined as a plain `const`.
- **`defaultLocale()` returns the short locale** (e.g., `"en"`, not `"en-CA"`). Use `fullLocale()` when you need the full BCP47 tag for `Intl` formatting.
- **Keep segment translations in sync** with route definitions in `src/integrations/i18n-routes.ts`. Adding a route without a corresponding segment in `segment-registry.ts` means the French/Spanish URL uses the English segment.

## Cross-References

- `src/integrations/i18n-routes.ts` — defines locale page routes, uses `translatePath()` for pattern generation
- `src/i18n/` — UI string translations (`en.json`, `fr.json`, `es.json`) and the `t()` helper
- `config/city-config.ts` — locale list comes from city config

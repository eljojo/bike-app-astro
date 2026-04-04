# i18n (`src/lib/i18n/`)

Locale utilities, URL path translations, and tag translations. Locales derived from city `config.yml`, never hardcoded.

## Files

| File | Role |
|------|------|
| `locale-utils.ts` | `shortLocale()`, `fullLocale()`, `defaultLocale()`, `supportedLocales()`, `localeLabel()` |
| `path-translations.ts` | `translatePath()`, `reverseTranslatePath()` — reads from `segment-registry.ts` |
| `segment-registry.ts` | Static map of URL segment translations. Add new segments here when adding translated routes |
| `tag-translations.ts` | `tTag()` — tag translations from YAML. Build-time transformed by `build-data-plugin.ts` |
| `locale-switcher.ts` | `switchLocalePath()` — computes URL for locale switching |

## Gotchas

- **Segment translations are a static `const`** in `segment-registry.ts`, NOT mutable state. Vite SSR has a separate module graph from integration hooks.
- **Keep segments in sync** with route definitions in `src/integrations/i18n-routes.ts`.
- **Build-time transform**: `tag-translations.ts` is replaced by `build-data-plugin.ts`. Update the transform if you change exports.
- **`defaultLocale()` returns short form** (`"en"`, not `"en-CA"`). Use `fullLocale()` for BCP47.

## Detailed Context

- [i18n system](../../../_ctx/i18n.md)

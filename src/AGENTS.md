# Source (`src/`)

Application source code. Public pages are static HTML; admin pages and API endpoints are server-rendered.

## Key Directories

```
src/
  components/     # .astro components + admin Preact islands (src/components/admin/)
  db/             # Drizzle schema, migrations init, transaction helper
  i18n/           # Locale JSON files (en.json, fr.json, es.json) + t() helper
  integrations/   # Astro integrations (route injection, i18n, build plugins)
  layouts/        # Base.astro (shell with header, nav, footer)
  lib/            # Core library — 13 domain directories + shared utilities
  loaders/        # Custom Astro content loaders (routes, pages, admin data)
  schemas/        # Zod schemas for content collections (barrel export via index.ts)
  styles/         # SCSS — _variables.scss is the design token source of truth
  types/          # TypeScript types (admin.ts, mapbox-polyline.d.ts)
  views/          # All pages + API endpoints (injected via injectRoute, no src/pages/)
```

`tsconfig.json` defines `@/*` -> `src/*` path alias. JSX configured for Preact.

## Must-Know Rules

- **Prerender flags**: every page/API endpoint MUST export `prerender` (true or false).
- **Virtual module types**: `src/virtual-modules.d.ts` is ambient — NO top-level imports or it breaks all declarations.
- **No client-side navigation**: full page loads, not `<ClientRouter />`. Use `DOMContentLoaded`, not `astro:page-load`.
- **Zod v4**: import from `zod/v4`, not `zod` or `astro/zod`.
- **Path resolution**: never use `path.resolve('relative/path')` — use `import.meta.dirname`.
- **Map markers**: never use default MapLibre markers — use CSS-styled HTML markers.

## Detailed Context

- [Content model & pipeline](../_ctx/content-model.md)
- [Virtual modules](../_ctx/virtual-modules.md)
- [Save pipeline](../_ctx/save-pipeline.md)
- [Instance types](../_ctx/instance-types.md)
- [Config layers](../_ctx/config-layers.md)
- [CI/CD workflows](../_ctx/ci-cd.md)
- [Adding new things (checklists)](../_ctx/adding-new-things.md)
- [Astro & Cloudflare gotchas](../_ctx/astro-cloudflare.md)

---
description: Checklists for adding content types, endpoints, routes, tables, virtual modules, islands
type: knowledge
triggers: [adding content types, adding endpoints, adding routes, adding database tables, adding virtual modules, adding preact islands, creating new features]
related: [save-pipeline, content-model, virtual-modules, i18n, preact-islands]
---

# Adding New Things — Checklists

## Adding a New Content Type (Admin-Editable)

1. `src/schemas/index.ts` — add Zod schema
2. `src/content.config.ts` — add collection with loader and base path
3. `src/lib/models/{type}-model.ts` — detail type, Zod validation, `fromGit()`, `fromCache()`, `buildFreshData()`, `computeContentHash()`
4. `src/loaders/admin-{type}s.ts` — admin data loader returning `{list, details}`
5. `src/build-data-plugin.ts` — register with `registerAdminModules({name: '{type}s', ...})`. Detail module strips trailing `s`
6. `src/lib/content/content-types.ts` — add to content type registry (routing, UI metadata, admin nav)
7. `src/virtual-modules.d.ts` — ambient type declarations (NO top-level imports)
8. `src/types/admin.ts` — add `Admin{Type}` interface for list view
9. `src/views/api/{type}-save.ts` — implement `SaveHandlers<T>` with `POST` export
10. `src/integrations/admin-routes.ts` — register admin pages + API endpoint
11. `src/views/admin/{type}-detail.astro` + `{type}-new.astro` — admin pages
12. `src/views/admin/{types}.astro` — admin list page
13. `src/components/admin/{Type}Editor.tsx` — Preact island
14. `src/styles/admin.scss` — all editor styles (NOT scoped `<style>`)
15. `src/lib/content/load-admin-content.ts` — add list overlay function if needed

All content data serialization/deserialization MUST go through model files. Never hand-roll `JSON.stringify`/`JSON.parse` for content types.

## Adding a New API Endpoint

1. Create file in `src/views/api/` (auth endpoints in `src/views/api/auth/`)
2. Add `export const prerender = false`
3. Add `authorize(user, action)` call — EVERY endpoint needs this (ESLint enforces it)
4. Register in `src/integrations/admin-routes.ts` — static routes MUST precede parameterized routes when they share a prefix
5. If public (no auth needed), add exclusion in `src/middleware.ts` `isProtected` check
6. If new permission needed, add action to `src/lib/auth/authorize.ts`

## Adding a New i18n Route

1. Add entry to `localePages` in `src/integrations/i18n-routes.ts`
2. Add URL segment translation to `src/lib/i18n/segment-registry.ts`
3. Add UI strings to `src/i18n/{en,fr,es}.json`
4. Create view file in `src/views/`

## Adding a New Database Table

1. Add Drizzle table in `src/db/schema.ts`
2. Run `npx drizzle-kit generate`
3. `init-schema.ts` picks it up for local dev
4. `wrangler.jsonc` `migrations_dir` ensures D1 gets it on deploy

## Adding a New Virtual Module

1. Add `resolveId` + `load` in `src/build-data-plugin.ts`
2. Add ambient type declaration in `src/virtual-modules.d.ts` (NO imports)
3. Tests work because `vitest.config.ts` includes the plugin

## Adding a New Preact Island

1. Create `.tsx` in `src/components/admin/`
2. ALL styles go in an underscore-prefixed SCSS partial `@use`'d from `src/styles/admin.scss`
3. Render with `client:load` or `client:visible`
4. Use `useHydrated()` hook from `src/lib/hooks.ts`
5. Ensure virtual module imports are declared in `virtual-modules.d.ts`

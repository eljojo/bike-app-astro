---
description: build-data-plugin virtual modules, ambient types, how to add new ones
type: pattern
triggers: [adding virtual modules, modifying build-data-plugin, working with admin data, debugging module resolution]
related: [content-model, adding-new-things]
---

# Virtual Modules

Vite plugin in `src/build-data-plugin.ts` provides 13+ virtual modules that supply build-time data to the application.

## Module Categories

### Admin Content Modules

Registered via `registerAdminModules()`, which strips trailing `s` for detail module names:

- `admin-routes` / `admin-route-detail`
- `admin-events` / `admin-event-detail`
- `admin-places` / `admin-place-detail`
- `admin-organizers`

### Media Index Modules

- `media-locations` — photo geolocation index
- `nearby-media` — proximity-based media index
- `parked-media` — orphaned media queue
- `media-shared-keys` — cross-content media registry

### Other Modules

- `cached-maps` — precomputed map thumbnail data
- `contributors` — contributor statistics

## Ambient Type Declarations

Types live in `src/virtual-modules.d.ts`. This file is **ambient** — it MUST NOT have top-level imports. Adding a top-level import converts it to a module and breaks all other ambient declarations in the file.

If you need to reference a type, use `import('...')` syntax inside the `declare module` block:

```typescript
declare module 'admin-routes' {
  const data: import('./types/admin').AdminRoute[];
  export default data;
}
```

`src/virtual.d.ts` handles `cached-maps` types separately.

## Build-Time Transforms

Three files are completely replaced during the Vite build by `build-data-plugin.ts`:

- `config/city-config.ts` → static JSON from config.yml
- `i18n/tag-translations.server.ts` → static translation map
- `fonts.server.ts` → static font preload URLs

If you change the exports of these files, you MUST also update the corresponding transform in `build-data-plugin.ts`.

## Testing

`vitest.config.ts` includes the build-data plugin so virtual modules resolve in tests. No special test setup needed.

## Adding a New Virtual Module

1. Add `resolveId` + `load` in `src/build-data-plugin.ts`
2. Add ambient type declaration in `src/virtual-modules.d.ts` (NO top-level imports)
3. Tests work automatically because `vitest.config.ts` includes the plugin

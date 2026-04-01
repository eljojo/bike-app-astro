# Maps (`src/lib/maps/`)

MapLibre GL JS initialization, style management, polyline/marker rendering, and map thumbnail generation. Client-side map code runs in the browser; generation code runs in Node.js during build.

## Files

| File | Role |
|------|------|
| `map-init.ts` | Core client-side map module: `initMap()`, `addPolylines()`, `addMarkers()` (clustered emoji places), `showPopup()` (shared single-popup-per-map), `removeSourceAndLayers()`. Pure helpers: `buildPolylineFeature()`, `decodeToGeoJson()`, `getRouteColor()`, `photoPopupMaxWidth()`. Constants: `ROUTE_COLOR`, `ROUTE_LINE_WIDTH`, `TOUR_PALETTE`. Most overlay logic moved to `layers/` — this file retains low-level functions used by admin maps and the layers themselves |
| `map-style-switch.ts` | `switchStyle()` — swaps MapLibre base style and replays setup callback. `loadStylePreference()`/`saveStylePreference()` for localStorage persistence. Exports `MapStyleKey` type |
| `map-style-url.ts` | Generated file (by `scripts/build-map-style.ts`) — exports content-hashed style JSON URLs. **Do not edit manually** |
| `map-style-url.d.ts` | Type declaration for the generated style URL module |
| `map-helpers.ts` | `html` tagged template literal with auto-escaping, `raw()` for pre-escaped HTML, `escapeHtml()`. `buildPlacePopup()`, `buildWaypointPopup()` — HTML popup builders for map markers |
| `map-paths.ts` | Browser-safe URL builders: `buildStaticMapUrl()`, `buildStaticMapUrlMulti()`, `MapThumbPaths` type. No `node:path` |
| `map-paths.server.ts` | `MAP_CACHE_DIR`, `mapThumbPaths()` — filesystem path construction using `node:path`. Server-only |
| `map-thumbnails.ts` | Runtime helpers that depend on virtual modules: `hasCachedMap()`, `cachedMapLocale()`. Re-exports from `map-paths.ts` |
| `map-generation.server.ts` | Node-only helpers for `scripts/generate-maps.ts`: `gpxHash()`, `needsRegeneration()`. Re-exports shared functions from `map-paths.ts` |
| `layers/` | Composable map layer system — `MapLayer` interface, `createMapSession()` orchestrator, layer implementations for polylines, photos, places, waypoints, GeoJSON lines, tile paths, GPS, elevation sync |

## Layer System (`layers/`)

Interactive map components (RouteMap, BigMap, BikePathMap) use a composable layer system. Each overlay is a `MapLayer` that handles its own setup, teardown, visibility, and style-switch replay.

| File | Role |
|------|------|
| `layers/types.ts` | `MapLayer` and `LayerContext` interfaces |
| `layers/map-session.ts` | `createMapSession()` — orchestrates map init, layer lifecycle, style switching |
| `layers/polyline-layer.ts` | Route polylines with click popups. Exposes `updateData()` and `setFilter()` for external mutation |
| `layers/photo-layer.ts` | Clustered photo bubble markers with zoom-responsive sizing |
| `layers/place-layer.ts` | Clustered emoji place markers |
| `layers/waypoint-layer.ts` | Checkpoint/danger/POI markers |
| `layers/geojson-line-layer.ts` | Fetch + render GeoJSON line files (async, with generation counter) |
| `layers/tile-path-layer.ts` | Viewport-based lazy tile loading for bike path network |
| `layers/gps-layer.ts` | User location dot |
| `layers/elevation-sync-layer.ts` | Cursor dot synced to elevation chart hover events |

### Key Pattern

Each layer's `setup()` is called on initial load AND after style switch (MapLibre's `setStyle()` strips all custom sources/layers). The `LayerContext.isCurrent()` method prevents stale async work from modifying the map after a newer style switch.

### Low-Level Functions Still Available

`map-init.ts` still exports `initMap()`, `addPolylines()`, `addMarkers()`, etc. for direct use by admin maps (`places.astro`), the paths index map, `PlaceEditor.tsx`, and `StaticRouteMap.tsx`. The layer system is a higher abstraction — it doesn't gate the low-level API.

## Gotchas

- **Never use default MapLibre markers** — use CSS-styled HTML markers (`poi-marker`, `photo-bubble`, `waypoint-marker`, `gps-dot` classes).
- **Style switching strips all custom layers.** `switchStyle()` takes a `replaySetup` callback that re-adds polylines, markers, and photo layers after the new style loads. DOM markers survive the switch.
- **`map-init.ts` is client-side only** — it imports `maplibre-gl` and uses `document`, `navigator`, `window`. Do not import from server-side code.
- **`map-paths.ts` has no virtual module imports** so build scripts can use it without Vite. `map-thumbnails.ts` adds the virtual module layer on top.
- **`map-style-url.ts` is generated** — run `scripts/build-map-style.ts` to regenerate after changing map styles.
- **`transformRequest`** in `initMap()` converts relative URLs to absolute — MapLibre's web worker cannot resolve relative paths.

## Cross-References

- `src/styles/` — map marker CSS classes (`poi-marker`, `photo-bubble`, `gps-dot`, `elevation-cursor-dot`)
- `scripts/generate-maps.ts` — uses `map-generation.ts` and `map-paths.ts` for thumbnail generation
- `src/components/` — Astro components initialize maps via `map-init.ts`

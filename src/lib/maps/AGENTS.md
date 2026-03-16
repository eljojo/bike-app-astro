# Maps (`src/lib/maps/`)

MapLibre GL JS initialization, style management, polyline/marker rendering, and map thumbnail generation. Client-side map code runs in the browser; generation code runs in Node.js during build.

## Files

| File | Role |
|------|------|
| `map-init.ts` | Core client-side map module: `initMap()`, `addPolylines()`, `addMarkers()` (clustered emoji places), `addPhotoMarkers()` (clustered photo bubbles), `addWaypointMarkers()`, `showUserLocation()`, layer visibility toggles, elevation cursor sync. Exports `ROUTE_COLOR`, `TOUR_PALETTE` |
| `map-style-switch.ts` | `switchStyle()` — swaps MapLibre base style and replays setup callback. `loadStylePreference()`/`saveStylePreference()` for localStorage persistence. Exports `MapStyleKey` type |
| `map-style-url.ts` | Generated file (by `scripts/build-map-style.ts`) — exports content-hashed style JSON URLs. **Do not edit manually** |
| `map-style-url.d.ts` | Type declaration for the generated style URL module |
| `map-helpers.ts` | `html` tagged template literal with auto-escaping, `raw()` for pre-escaped HTML, `escapeHtml()`. `buildPlacePopup()`, `buildWaypointPopup()` — HTML popup builders for map markers |
| `map-paths.ts` | Browser-safe URL builders: `buildStaticMapUrl()`, `buildStaticMapUrlMulti()`, `MapThumbPaths` type. No `node:path` |
| `map-paths.server.ts` | `MAP_CACHE_DIR`, `mapThumbPaths()` — filesystem path construction using `node:path`. Server-only |
| `map-thumbnails.ts` | Runtime helpers that depend on virtual modules: `hasCachedMap()`, `cachedMapLocale()`. Re-exports from `map-paths.ts` |
| `map-generation.server.ts` | Node-only helpers for `scripts/generate-maps.ts`: `gpxHash()`, `needsRegeneration()`. Re-exports shared functions from `map-paths.ts` |

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

# Maps (`src/lib/maps/`)

MapLibre GL JS initialization, style management, polyline/marker rendering, and map thumbnail generation.

## Files

| File | Role |
|------|------|
| `map-init.ts` | Core client-side: `initMap()`, `addPolylines()`, `addMarkers()`, `showPopup()` |
| `map-style-switch.ts` | `switchStyle()` — swaps base style and replays setup callback |
| `map-style-url.ts` | **Generated** — content-hashed style JSON URLs. Do not edit manually |
| `map-helpers.ts` | `html` tagged template with auto-escaping, popup builders |
| `map-paths.ts` | Browser-safe URL builders (no `node:path`) |
| `map-paths.server.ts` | Filesystem path construction (server-only) |
| `map-thumbnails.ts` | Runtime helpers depending on virtual modules |
| `map-generation.server.ts` | Node-only helpers for `scripts/generate-maps.ts` |
| `layers/` | Composable layer system: `MapLayer` interface, `createMapSession()`, layer implementations |

## Gotchas

- **Never use default MapLibre markers** — use CSS-styled HTML markers.
- **Style switching strips all custom layers.** The `replaySetup` callback re-adds them. DOM markers survive.
- **`map-init.ts` is client-side only** — uses `document`, `navigator`, `window`. Never import from server code.
- **`map-paths.ts` has no virtual module imports** so build scripts can use it without Vite.
- **`transformRequest`** converts relative URLs to absolute — MapLibre's web worker cannot resolve relative paths.

## Detailed Context

- [CSS styling (map marker classes)](../../../_ctx/css-styling.md)

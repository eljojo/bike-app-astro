---
description: "How bike path geometry is tiled, what metadata tiles carry, how detail pages use tiles for highlight + context"
type: knowledge
triggers: [working with bike path map, modifying tile generation, changing map layers, debugging path rendering, adding tile metadata]
related: [bike-paths, pipeline-overview]
---

# Bike Path Tiles

## Overview

Bike path geometry is served to the browser via **meta tiles** — GeoJSON files containing merged, metadata-enriched features split by an adaptive quadtree. The browser never loads individual path GeoJSON files.

## Build Pipeline

```
.cache/bikepath-geometry/{city}/*.geojson   (source: Overpass API cache)
  |
  +-> scripts/generate-geo-metadata.ts     -> public/bike-paths/geo/geo-metadata.json
  |     reads bikepaths.yml + markdown
  |     maps geoId -> { slug, name, surface, hasPage, path_type, ... }
  |
  +-> scripts/generate-path-tiles.ts       -> public/bike-paths/geo/tiles/
        reads individual GeoJSONs from cache + metadata JSON
        1. Merges all features per geoId into one MultiLineString
        2. Truncates coordinates to 5 decimal places (1m precision)
        3. Injects metadata from geo-metadata.json
        4. Splits via adaptive quadtree (target: <300K coords per tile)
        Output: tile-{id}.geojson + manifest.json
```

## Tile Feature Properties

Each feature in a tile carries these properties:

| Property | Type | Description |
|----------|------|-------------|
| `_geoId` | string | Geometry identity (relation ID or slug-based filename) |
| `_fid` | string | Same as `_geoId` (one feature per path after merge) |
| `slug` | string | URL slug for the path |
| `name` | string | Display name |
| `memberOf` | string | Parent network slug (empty if none) |
| `surface` | string | Surface type (asphalt, gravel, etc.) |
| `hasPage` | boolean | Whether this path has a detail page |
| `path_type` | string | Infrastructure type (mup, bike-lane, trail, etc.) |
| `length_km` | number | Total length in km |

## Adaptive Quadtree

Instead of a fixed grid, tiles are split recursively:
- Start from data bounds of all paths
- If a tile exceeds the coordinate threshold (~300K), split into 4 quadrants
- Recurse until all tiles fit (max depth 12)
- Dense urban areas get small tiles; sparse rural areas keep large ones
- Cross-boundary paths are duplicated (same `_fid` enables client-side dedup)
- Tile IDs are opaque (quadtree path strings) — the manifest carries bounds

## Manifest Format

`manifest.json` is an array of `TileManifestEntry`:

```json
[
  { "id": "0_2_1", "bounds": [-75.8, 45.2, -75.5, 45.5], "featureCount": 170, "file": "tile-0_2_1.geojson" }
]
```

The client loads the manifest once, then fetches tiles whose bounds intersect the viewport.

## Client-Side Usage

### Index page + BigMap (overview)
- Load tiles for viewport via `TileLoader`
- Features already carry metadata — no enrichment step
- `hasPage` drives interactive/non-interactive styling
- Click handler reads `slug` + `memberOf` to construct path URL
- Network tab highlighting uses `data-network-geo-ids` / `data-category-geo-ids` with `_geoId` matching

### Detail pages (BikePathMap)
- Same tile system as overview pages
- `highlightGeoIds` prop (set of `_geoId` values for the current path)
- Highlighted features render bold; everything else renders as faded context
- Neighboring paths appear automatically from loaded tiles — no extra fetches

## Key Files

| File | Role |
|------|------|
| `scripts/generate-path-tiles.ts` | Build: merge, truncate, metadata, quadtree split |
| `scripts/generate-geo-metadata.ts` | Build: geoId -> page metadata bridge |
| `src/lib/maps/tile-types.ts` | Shared types: `TileManifestEntry`, `TileFeatureMeta` |
| `src/lib/maps/tile-loader.ts` | Client: viewport-based tile loading with dedup |
| `src/lib/maps/layers/tile-path-layer.ts` | Client: MapLibre layer with highlight support |
| `src/components/BikePathMap.astro` | Component: expandable tile-based map |

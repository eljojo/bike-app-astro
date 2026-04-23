---
description: "How bike path geometry is tiled, what metadata tiles carry, how detail pages use tiles for highlight + context"
type: knowledge
triggers: [working with bike path map, modifying tile generation, changing map layers, debugging path rendering, adding tile metadata]
related: [bike-paths, pipeline-overview, path-types]
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

## Segment resolution

Tile features carry an optional `_segments: Segment[]` property that turns the merged MultiLineString into a map of clickable sub-units. A `Segment` is one logical sub-path of the entry — grouped from OSM ways that share a `name` tag — with a segment-wide `surface_mix` and a `lineCount` that partitions the feature's geometry.

**The invariant.** The MultiLineString of each merged tile feature is assembled such that all sub-lines belonging to `_segments[0]` come before any sub-line of `_segments[1]`, and so on. The `lineCount` on each segment is exactly the length of its contiguous run of sub-lines. The click handler `resolveSegmentFromClick` in `src/lib/maps/layers/tile-path-interactions.ts` walks `_segments` with a running offset to map a clicked sub-line index back to the owning segment in O(segments) after an O(sub-lines) geometric search.

**Where the invariant is enforced.** `mergeFeatures` in `scripts/generate-path-tiles.ts` produces the geometry in segment order and records `lineCount` per segment. The JSDoc on the function names `resolveSegmentFromClick` as the dependent reader so any change to the emission order forces a matching update in the click handler.

**Where the type lives.** `Segment` is defined in `src/lib/maps/tile-types.ts` with JSDoc on `lineCount` that states the same invariant in type-level context — the third place a grep for "contiguous ordering" surfaces it.

**Where the grouping rule lives.** `groupWaysIntoSegments` in `src/lib/bike-paths/segments.ts` is the single source of truth for how OSM ways collapse into logical segments: same name = same segment, regardless of surface or physical connectivity; unnamed ways collapse into a single `{name: undefined}` segment; `surface_mix` is segment-wide and identical across every copy of a segment in every surface-category tile feature the segment appears in.

**Why segments are duplicated across surface-category features.** A mixed-surface named segment (e.g. "Path #15" with mostly-asphalt and a short gravel bridge) has sub-lines in two surface-category features (the `road` feature and the `gravel` feature). The same `Segment` record is attached to both features with the same `surface_mix`; only the `lineCount` differs per copy (it's the count of sub-lines of this segment that live in that specific surface category). Duplication cost is trivial (~50 bytes per cross-category segment) and avoids a sidecar-table lookup at click time.

**Two display modes in the popup.** `buildPathPopup` (in `src/lib/maps/map-helpers.ts`) renders the segment first when the resolved segment has a name different from the entry's name (Mode B). When the segment is absent, unnamed, or has a name matching the entry's name, the popup falls back to the entry-level rendering (Mode A) — preserving today's experience for single-named paths.

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

## Map Style Coordination

`src/lib/maps/map-swatch.ts` is the single source of truth for all overlay line styles (colors, widths, opacities). All map rendering code reads from here — never hardcode visual properties in layer setup.

Two contexts:
- **Routes foreground** — curated route polylines are the star. Bike path overlay is thin, faded background. Base map cycling layers at full strength.
- **Paths foreground** — bike path overlay is the star. Base map cycling layers mute (they show the same data). Interactive paths (has page) are bold; non-interactive are dimmed.

Trails (`path_type: mtb-trail` or `trail`) render with dashed lines via `TRAIL_DASH` / `IS_TRAIL_EXPR`.

## Interaction Model

`src/lib/maps/paths-browse-map.ts` orchestrates the browse/index map. `src/lib/maps/path-highlight.ts` handles list-to-map hover synchronization.

**Desktop:** mouseenter/mouseleave on list items triggers hover highlight on map + delayed fly-to (300ms delay to avoid jitter when scanning).

**Mobile:** tap on list item toggles highlight. Tap on map background dismisses. Map capped at 40vh. iOS long-press prevention applied. Desktop hover listeners gated behind a mobile check.

**State decoupling:** DOM events write to a `wantSlug` variable; an animation loop reads and applies. This eliminates race conditions from event ordering when tiles haven't loaded yet.

## Key Files

| File | Role |
|------|------|
| `scripts/generate-path-tiles.ts` | Build: merge, truncate, metadata, quadtree split |
| `scripts/generate-geo-metadata.ts` | Build: geoId -> page metadata bridge |
| `src/lib/maps/tile-types.ts` | Shared types: `TileManifestEntry`, `TileFeatureMeta` |
| `src/lib/maps/tile-loader.ts` | Client: viewport-based tile loading with dedup |
| `src/lib/maps/layers/tile-path-layer.ts` | Client: MapLibre layer with highlight support |
| `src/components/BikePathMap.astro` | Component: expandable tile-based map |

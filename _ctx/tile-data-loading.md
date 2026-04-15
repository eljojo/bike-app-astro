---
description: "How to load tile data correctly — resolve geoIds to tiles before computing, never depend on viewport"
type: rule
triggers: [working with tile path layer, computing bounds from features, fitToGeoIds, loading tile data]
related: [bike-path-tiles, spatial-reasoning]
---

# Tile Data Loading

## The Rule

**Never compute from partially-loaded data. Always resolve what you need, load it, then compute.**

The tile system loads GeoJSON features on demand. Features are spread across tiles. If you try to compute bounds (or anything else) from `allLoadedFeatures()`, you'll get wrong results when tiles haven't loaded yet.

## The Correct Order of Operations

```
geoIds → geo-metadata.json → slugs → slug-index.json → tile IDs → load tiles → features
```

1. **Know what you need** — the geoIds you want to work with
2. **Find where it lives** — resolve geoIds to tile IDs via the index chain
3. **Load exactly those tiles** — `tileLoader.loadTilesByIds(tileIds)`
4. **Use the data** — compute bounds, filter features, etc.

## The Index Chain

| File | Maps | Location |
|------|------|----------|
| `geo-metadata.json` | geoId → `{slug, name, surface, ...}` | `/bike-paths/geo/geo-metadata.json` |
| `slug-index.json` | slug → `{tiles: string[], hash}` | `/bike-paths/geo/tiles/slug-index.json` |
| `manifest.json` | tile metadata (bounds, feature count) | `/bike-paths/geo/tiles/manifest.json` |

## The Library

`src/lib/maps/geo-id-resolver.ts` implements this chain:

```typescript
import { loadFeaturesForGeoIds } from '../geo-id-resolver';

// Loads exactly the tiles needed, returns matching features
const features = await loadFeaturesForGeoIds(tileLoader, geoIds);
```

Both index files are fetched once and cached in memory.

## What NOT to Do

- **Never call `allLoadedFeatures()` and assume it has what you need.** Tiles load based on viewport — features outside the viewport aren't loaded.
- **Never load all tiles eagerly.** There could be hundreds. Load what you need.
- **Never compute bounds from the current viewport.** The features you need might be outside it.
- **Never use `loadTilesForBounds(currentViewport)` as a substitute.** Features can exist in tiles outside the viewport.

## When to Use

- `fitToGeoIds` — computing bounding box to zoom to specific features
- Any operation that needs feature geometry for a known set of geoIds
- Tab switching on the bike paths index (category geoIds → zoom)

## When NOT Needed

- Rendering features in the current viewport (the `moveend` handler already loads tiles for the viewport)
- Checking if a feature is loaded (use `allLoadedFeatures()` for display-only checks)

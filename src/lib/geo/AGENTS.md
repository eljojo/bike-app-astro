# Geo (`src/lib/geo/`)

Geographic calculations for routes, places, and photos. Pure functions on coordinate data.

## Files

| File | Role |
|------|------|
| `proximity.ts` | `haversineM()`, `findNearbyPlaces()`. Distance thresholds: `PLACE_NEAR_ROUTE_M`, `PHOTO_NEARBY_M`, `PHOTO_NEAR_PLACE_M` |
| `distance.ts` | `formatDistance()` — formats distance arrays into display strings |
| `elevation.ts` | `elevationConclusion()`, `elevationTags()` — quantile-based classification |
| `elevation-profile.ts` | `computeElevationProfile()` — SVG path data for elevation charts |
| `elevation-enrichment.ts` | `enrichWithElevation()` — fetches from Open-Meteo API |
| `media-geo-interpolation.ts` | `interpolateMediaLocation()` — estimates media GPS from GPX timestamps |
| `media-proximity.ts` | `findNearbyMedia()` — cross-route media within 200m |
| `privacy-zone.ts` | `filterPrivacyZone()`, `stripPrivacyMedia()` — removes points near private locations |

## Gotchas

- **Haversine** lives in `proximity.ts` as the single source of truth.
- **Distance thresholds** are important constants: places 300m, photos 200m, photos near places 750m. Changing these affects route pages.
- **Privacy zone** is opt-in per city via `privacy_zone` in `config.yml`. Removes points entirely (no fuzzing).
- **Elevation enrichment** is the only file making network requests (Open-Meteo). Batches in groups of 100.

## Detailed Context

- [Content model](../../../_ctx/content-model.md)

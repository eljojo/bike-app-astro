# Geo (`src/lib/geo/`)

Geographic calculations for routes, places, and photos. Pure functions operating on coordinate data — no external API calls except `elevation-enrichment.ts` which fetches from Open-Meteo.

## Files

| File | Role |
|------|------|
| `proximity.ts` | `haversineM()`, `findNearbyPlaces()` — haversine distance in meters, finds places within 300m of a route track using bounding-box pre-filter. Exports distance thresholds (`PLACE_NEAR_ROUTE_M`, `PHOTO_NEARBY_M`, `PHOTO_NEAR_PLACE_M`) |
| `distance.ts` | `formatDistance()` — formats distance arrays into display strings (e.g., "25 km" or "20-30 km"), rounds to nearest 5 km |
| `elevation.ts` | `elevationConclusion()`, `elevationTags()` — quantile-based elevation classification relative to all routes (e.g., "flat", "above_average"). Uses `isPublished` filter |
| `elevation-profile.ts` | `computeElevationProfile()`, `computeElevationPoints()` — generates SVG path data for elevation charts, downsamples to ~200 points. Exports chart dimensions as `CHART` constant |
| `elevation-enrichment.ts` | `enrichWithElevation()` — fetches elevation data from Open-Meteo API, interpolates across track points. Used when importing routes without elevation data (e.g., Google Maps KML). Also exports `buildGpxFromPoints()` |
| `photo-geo-interpolation.ts` | `interpolatePhotoLocation()` — estimates photo GPS coordinates by interpolating timestamps against GPX track time data. Binary search for performance |
| `photo-proximity.ts` | `findNearbyPhotos()` — finds photos from other routes within 200m of a route track. Bounding-box pre-filter then haversine check |
| `privacy-zone.ts` | `filterPrivacyZone()`, `stripPrivacyPhotos()` — removes track points and photo coordinates within a configurable radius of a private location (e.g., home). Per-city config in `config.yml` |

## Gotchas

- **Haversine is duplicated** in `proximity.ts` and `privacy-zone.ts` — both have their own implementation. `proximity.ts` is the canonical one; `privacy-zone.ts` has its own because it's a standalone module.
- **Elevation enrichment calls an external API** (Open-Meteo) — it's the only file in this domain that makes network requests. It batches in groups of 100 with a 5-second timeout per batch.
- **Distance thresholds** are important constants: places within 300m, photos within 200m, photos near places within 750m. Changing these affects which places/photos appear on route pages.
- **Privacy zone** is opt-in per city via `privacy_zone` in `config.yml`. The filter removes points entirely (not fuzzes them).

## Cross-References

- `src/loaders/routes.ts` — calls `findNearbyPlaces` at build time
- `src/build-data-plugin.ts` — calls `findNearbyPhotos` for the `nearby-photos` virtual module
- `config/city-config.ts` — `privacy_zone` field defines zone center and radius

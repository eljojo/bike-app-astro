---
title: Route Data API
description: Machine-readable JSON endpoints for route data on whereto.bike instances.
---

Every whereto.bike wiki instance publishes route data as static JSON — prerendered at build time, no authentication required. These endpoints mirror the HTML pages as machine-readable data.

## Endpoints

### Per-route detail

```
/routes/{slug}.json
```

Full route data for one route. Localized variants follow the same pattern as HTML pages:

```
/fr/parcours/{slug}.json
```

### Route index

```
/routes.json
```

Lightweight list of all published routes — enough for a listing page or search. Also localized:

```
/fr/parcours.json
```

## Per-route detail shape

```json
{
  "id": "vincent-massey",
  "name": "Vincent Massey Park",
  "tagline": "A quiet loop along the Rideau River",
  "url": "/routes/vincent-massey",
  "distance_km": 12.4,
  "tags": ["scenic", "river"],
  "created_at": "2024-03-15",
  "updated_at": "2025-01-20",
  "variants": [
    {
      "name": "Default",
      "key": "variants-default",
      "distance_km": 12.4,
      "elevation_gain_m": 45,
      "elevation_conclusion": "mostly_flat",
      "shape": "loop",
      "difficulty_score": 18,
      "difficulty_label": "easy",
      "polyline": "encoded_string...",
      "center": [45.383, -75.697],
      "bounds": [[45.37, -75.72], [45.40, -75.67]],
      "gpx_url": "/routes/vincent-massey/variants-default.gpx",
      "strava_url": "https://..."
    }
  ],
  "media": [
    {
      "type": "photo",
      "key": "abc123",
      "url": "https://r2.example.com/abc123",
      "caption": "The river view from the south path",
      "cover": true,
      "width": 4032,
      "height": 3024,
      "lat": 45.383,
      "lng": -75.697
    }
  ],
  "nearby_places": [
    {
      "id": "some-cafe",
      "name": "Some Cafe",
      "category": "cafe",
      "distance_m": 120,
      "lat": 45.384,
      "lng": -75.698
    }
  ],
  "similar_routes": [
    { "id": "hog-s-back", "name": "Hog's Back Falls", "score": 67 }
  ],
  "translations": {
    "fr": {
      "name": "Parc Vincent-Massey",
      "tagline": "Une boucle tranquille le long de la rivière Rideau",
      "url": "/fr/parcours/vincent-massey"
    }
  }
}
```

### Field reference

**Root fields:**
- `id` — route slug, stable identifier
- `name`, `tagline` — localized to the endpoint's locale
- `url` — absolute path to the HTML page for this locale
- `distance_km` — route distance in kilometres
- `tags` — content tags
- `created_at`, `updated_at` — ISO date strings

**Variant fields:**
- `key` — variant key derived from GPX filename
- `elevation_gain_m` — total climbing in metres
- `elevation_conclusion` — relative to site distribution: `flat`, `mostly_flat`, `fairly_flat`, `average`, `above_average`, `hard`, `very_hard`
- `shape` — `loop`, `out-and-back`, `one-way`, or absent
- `difficulty_score` — raw numeric score
- `difficulty_label` — relative tier: `easiest`, `easy`, `average`, `hard`, `hardest`
- `polyline` — encoded polyline (polyline5 format)
- `center` — `[lat, lng]` midpoint of track
- `bounds` — `[[sw_lat, sw_lng], [ne_lat, ne_lng]]`
- `gpx_url` — path to downloadable GPX file
- `strava_url`, `rwgps_url`, `komoot_url` — optional external links

**Media fields:**
- `type` — `photo` or `video`
- `key` — media asset identifier
- `url` — direct object URL (no resizing, raw asset)
- `caption` (photos), `title` (videos) — optional description
- `cover` — true if this is the route's cover image
- `width`, `height` — pixel dimensions
- `lat`, `lng` — GPS coordinates (if available)
- `duration` — ISO 8601 duration (videos only)

**Nearby places:**
- Within 300m of the route track
- Sorted by distance

**Similar routes:**
- Top 3 by polyline overlap score (0–100)

**Translations:**
- Keyed by locale code
- Contains localized `name`, `tagline`, and `url`

## Route index shape

```json
{
  "routes": [
    {
      "id": "vincent-massey",
      "name": "Vincent Massey Park",
      "tagline": "A quiet loop along the Rideau River",
      "url": "/routes/vincent-massey",
      "distance_km": 12.4,
      "tags": ["scenic", "river"],
      "shape": "loop",
      "difficulty_label": "easy",
      "cover": {
        "key": "abc123",
        "url": "https://r2.example.com/abc123",
        "width": 4032,
        "height": 3024
      }
    }
  ]
}
```

The index omits polylines, full media lists, nearby places, similar routes, and variant details beyond the primary. Enough for a listing or search.

## Notes

- **Wiki instances only.** Blog and club instances do not generate these endpoints.
- **Published routes only.** Draft routes are excluded.
- **No authentication.** These are public, static JSON files.
- **Photos** use direct R2 object URLs — no resizing parameters. If you need thumbnails, use your own image proxy.
- **Difficulty labels** (`easiest`, `easy`, `average`, `hard`, `hardest`) and **elevation conclusions** are machine-readable tier names relative to the site's route distribution. Consumers should translate them into user-facing language appropriate for their context.
- **Polylines** use the [polyline5 format](https://developers.google.com/maps/documentation/utilities/polylinealgorithm) (precision 5). Decode with any standard polyline library.

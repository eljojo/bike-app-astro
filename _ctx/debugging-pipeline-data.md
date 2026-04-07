---
description: "How to debug bike path pipeline and data issues — always verify against OSM via Overpass first"
type: rule
triggers: [debugging bike paths, wrong geometry, wrong network membership, name collision, pipeline data issues, bikepaths.yml bugs]
related: [pipeline-overview, bike-paths, spatial-reasoning]
---

# Debugging Pipeline & Data Issues

## First Principle: Verify Against OSM

When a bike path shows wrong geometry, wrong network membership, or wrong metadata:

1. **Query Overpass first** — don't just read cached geojson or bikepaths.yml. Those are derived data. OSM is the source of truth.
2. **Get the way IDs** — every path is composed of OSM ways. Find the actual way IDs via Overpass, then trace how the pipeline handled them.
3. **Use the project's Overpass instance**: `https://overpass.whereto.bike/api/interpreter`

## Common Query Patterns

### Find ways by name near coordinates
```
[out:json];
way["name"="Trail 1"](45.48,-76.11,45.51,-76.07);
out tags;
```

### Find ways by ID with geometry
```
[out:json];
way(id:727305105,727312122);
out geom;
```

## Name Collisions Are Real

The pipeline discovers paths by name. When two physically separate paths share the same OSM name (e.g. "Trail 1" exists in both Gatineau Park and the Greenbelt), the pipeline disambiguates slugs with `-1`, `-2` suffixes. But geometry resolution uses `name-{slug}.geojson` files — if the disambiguation assigns the wrong geometry to the wrong slug, a path page will show geometry from a completely different location.

**Don't dismiss location complaints.** If a user says "this path shows geometry from Gatineau Park but it's supposed to be in the Greenbelt," they're almost certainly right. The most common cause is a name collision in the pipeline.

## Debugging Checklist

1. **Query Overpass** for the way IDs at the reported location
2. **Check bikepaths.yml** — does the entry have `osm_way_ids`? If not, it was matched by name (fragile)
3. **Check the geometry cache** — does `name-{slug}.geojson` contain the right way IDs?
4. **Check geo-metadata.json** — does the geoId map to the right slug and memberOf?
5. **Check tiles** — does the tile contain features with the right `_geoId` for this path?
6. **Trust the user's eyes** — if they say the map shows the wrong place, it does

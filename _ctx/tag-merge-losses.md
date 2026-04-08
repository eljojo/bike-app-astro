---
description: "mergeWayTags majority-vote for physical tags, plus surface_mix/lit_mix distributions for mixed entries"
type: knowledge
triggers: [working with mergeWayTags, surface facts, width facts, path detail facts, mixed surface]
related: [pipeline-overview, bike-paths, path-types]
---

# Tag Merge Losses

## The Problem

`mergeWayTags` in `build-bikepaths.mjs` picks the most common value for each OSM tag across all ways in an entry. When a path has mixed surfaces (e.g. Watts Creek: asphalt + unpaved + ground + fine_gravel), only the majority value survives. The minority values are lost.

This matters for physical tags that directly affect ride planning: `surface`, `width`, `lit`, `smoothness`. The `[tag-merge]` log line fires when >30% of ways disagree on a physical tag.

## How It's Handled

`mergeWayTags` still picks a majority winner for `surface` and `lit` (other code depends on a single canonical value), but it now also computes length-weighted distributions for mixed entries:

- **`surface_mix`** — `Array<{ value: string, km: number }>`, sorted by km descending. Only produced when 2+ distinct surfaces exist. Stored in bikepaths.yml alongside the majority `surface` value.
- **`lit_mix`** — same shape, only produced when both `yes` and `no` are present.

Distributions are weighted by real way geometry (`wayLengthKm()`), not way count. The Overpass enrichment query uses `out geom tags` so relation member ways carry geometry for accurate length computation.

## Schema

```yaml
# bikepaths-yml.server.ts
surface_mix: z.array(z.object({ value: z.string(), km: z.number() })).optional()
lit_mix: z.array(z.object({ value: z.string(), km: z.number() })).optional()
```

## Facts Engine

The facts engine (`bike-path-facts.ts`) emits `surface_mixed` and `lit_mixed` facts for individual entries — the same breakdown pattern already used for networks:

- **`surface_mixed`** renders as "Paved (8 km), Gravel (1 km)" using `localizeSurface()` per breakdown entry. All surface categories are translated in en/es/fr.
- **`lit_mixed`** renders as a single localized string via `paths.fact.partially_lit` ("Some paths lit, some not" / "Certains sentiers éclairés, d'autres non" / "Algunos senderos iluminados, otros no").

## What's Still Majority-Vote Only

`width` and `smoothness` still lose minority values. These are less critical for ride planning than surface and lighting, but the same distribution approach could be applied if needed.

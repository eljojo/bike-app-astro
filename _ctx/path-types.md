---
description: "path_type field in bikepaths.yml — classifies cycling infrastructure by safety and bike requirements"
type: knowledge
triggers: [working with path_type, adding bike path facts, displaying infrastructure type, filtering paths by type]
related: [pipeline-overview, markdown-overrides, entry-types]
---

# Path Types

Every non-network entry in `bikepaths.yml` has a `path_type` field that tells a cyclist two things: how safe the ride will be, and what kind of bike they need.

## Values

Listed from most separated to least:

| `path_type` | What a cyclist sees | Typical OSM tags |
|---|---|---|
| `mup` | Multi-use pathway shared with pedestrians, fully separated from cars | `highway=cycleway` or `highway=path` + `bicycle=designated`, no `parallel_to` |
| `separated-lane` | Protected bike lane with physical barrier from traffic | `parallel_to` + `cycleway=track` |
| `bike-lane` | Painted lane on the road, no physical barrier | `parallel_to` + `cycleway=lane` |
| `paved-shoulder` | Road shoulder, rideable but not dedicated | `parallel_to` + `cycleway=shoulder` |
| `mtb-trail` | Mountain bike trail, unpaved and technical | `mtb=true` or `mtb:scale` present |
| `trail` | Unpaved path — gravel, dirt, forest. Not technical MTB | Unpaved surface, `highway=path` or `highway=cycleway` |

## Derivation

`src/lib/bike-paths/classify-path.ts` computes `path_type` from OSM tags. Markdown frontmatter can override it. The derivation order matters — first match wins:

1. `mtb == true` → `mtb-trail`
2. `parallel_to` + `cycleway == "track"` → `separated-lane`
3. `parallel_to` + `cycleway == "shoulder"` → `paved-shoulder`
4. `parallel_to` (on a road highway, or non-cycleway) or road highway + `cycleway` tag → `bike-lane`. Exception: `parallel_to` + `highway=cycleway` (not a road) falls through to `mup` — standalone cycleways alongside roads (e.g. canal paths) are MUPs, not bike lanes.
5. Surface is unpaved → `trail`
6. `highway=cycleway` (implies pavement) → `mup`
7. Known paved surface → `mup`
8. Everything else → `trail`

MUP requires evidence of pavement. `highway=path` or `highway=footway` with no surface data defaults to trail, not mup. `highway=cycleway` implies pavement even without an explicit surface tag.

## Networks

Network entries (`type: network`) do not carry `path_type`. The Astro app aggregates `path_type` from member entries, the same way it aggregates `surface` — with unanimous/partial/mixed consistency.

## Relationship to `mtb`

The `mtb: true` boolean stays in bikepaths.yml. MTB detection runs in three tiers in `src/lib/bike-paths/classify-path.ts`: tier-1 (explicit `mtb:scale` tags) and tier-3 (ambient — unpaved trail without `bicycle=designated`) run before clustering in `classifyPathsEarly`; tier-2 (network inference) runs after clustering in `classifyPathsLate`. Tier-3 ambient detection skips entries with `fine_gravel` or `compacted` surface — these are maintained multi-use paths, not MTB terrain. `mtb:scale=0` means "any bike, no difficulty" and does NOT trigger MTB detection. For display, the app uses `path_type: mtb-trail` rather than the raw boolean.

## Facts table

`path_type` appears as a fact in the bike path detail view.

- Label key: `paths.label.path_type`
- Value keys: `paths.fact.mup`, `paths.fact.separated_lane`, `paths.fact.bike_lane`, `paths.fact.paved_shoulder`, `paths.fact.mtb_trail`, `paths.fact.trail`
- For networks: aggregated from members with consistency breakdown, same pattern as `surface`

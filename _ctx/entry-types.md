---
description: "type field in bikepaths.yml — classifies every entry by its role in the user experience"
type: pattern
triggers: [working with entry types, deciding what gets a page, filtering entries for display, scoring bike paths]
related: [pipeline-overview, path-types, markdown-overrides]
---

# Entry Types

Every entry in `bikepaths.yml` has a `type` field that determines what role it plays in the user experience.

## Values

| `type` | Gets a page? | On the map? | Has members? | Example |
|---|---|---|---|---|
| `trail` | Yes | Yes | Optional (sections) | Cycloparc PPJ, Route Verte, Trans Canada Trail |
| `network` | Yes (network page) | Yes (aggregated) | Yes | Capital Pathway, NCC Greenbelt |
| `destination` | Yes (standalone or member page) | Yes | No | Sawmill Creek, Trans Orléans, La Boucle |
| `infrastructure` | No | Yes | No | Bank Street bike lane, Greenbank Road |
| `connector` | No | No | No | Trilby Court, unnamed park connector |

When absent, the app treats the entry as `infrastructure` (visible on map, no standalone page).

## Trail vs Network vs Destination

A **trail** is a named long-distance route that people plan trips for. It has its own real-world identity — a website, a ref code on signs, maybe a Wikipedia article. Examples: Cycloparc PPJ (100km rail trail), Route Verte 1 (provincial cycling network), Trans Canada Trail, Algonquin Trail, Prescott-Russell Trail.

A **network** is an interconnected system of paths within a metro area. Nobody "rides the Capital Pathway" as a trip — they ride on parts of it. A network is infrastructure that organizes other paths.

A **destination** is a local path with enough identity to deserve its own page — a named park trail, a creek pathway — but it's not a trip you'd plan for specifically.

Both trails and networks can have `members` arrays. A trail with members has sections (Trans Canada Trail has Ottawa-Carleton Trailway, Bells Corners segment, etc.). A network with members has constituent paths. The `members` array drives the same behavior (member refs, geometry aggregation) regardless of type.

## Derivation

The pipeline computes `type` after `path_type` and MTB detection. Markdown frontmatter can override it.

- **`trail`** — has `network: ncn` (national) or `network: rcn` (regional) AND has `osm_relations`. Also assigned to superroutes with ncn/rcn tags.
- **`network`** — assigned by the pipeline's network discovery step for metro-level superroutes and park groupings.
- **`destination`** — has `osm_relations` (a named cycling route in OSM), OR `path_type: mtb-trail`, OR MUP/trail above the city's length threshold.
- **`infrastructure`** — `bike-lane` or `paved-shoulder` on a real road, OR short named MUP/trail.
- **`connector`** — tiny bike lane on a minor street, unnamed chain below minimum length.

## Relationship to other fields

- **`path_type`** — what kind of infrastructure (mup, bike-lane, mtb-trail). A trail can be `path_type: mup` (paved) or `path_type: trail` (unpaved). The two "trail" meanings are different: `path_type: trail` = unpaved surface, `type: trail` = long-distance touring route.
- **`member_of`** — network/trail membership. A `destination` can be a member of a network or trail.
- **`members`** — both trails and networks can have members. The app checks `members.length > 0` for member behavior, not `type === 'network'`.
- **`featured`** — markdown-only field for homepage placement. Orthogonal to `type`.

## Usage in code

```
entry.type === 'trail'         // is this a long-distance trail?
entry.type === 'network'       // is this a city-level network?
entry.type === 'destination'   // is this a local destination path?
entry.members?.length > 0     // does this have members? (trails OR networks)
```

The Zod schema validates `type` as an enum: `z.enum(['trail', 'network', 'destination', 'infrastructure', 'connector']).optional()`.

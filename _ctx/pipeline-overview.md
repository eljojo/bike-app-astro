---
description: "How build-bikepaths.mjs discovers, names, clusters, and networks cycling infrastructure"
type: pattern
triggers: [modifying the pipeline, debugging bikepaths.yml output, adding discovery steps, changing naming logic]
related: [spatial-reasoning, naming-unnamed-chains, markdown-overrides]
---

# Pipeline Overview

`scripts/pipeline/build-bikepaths.mjs` builds bikepaths.yml from scratch every run (`make bikepaths`). No incremental merge.

## Steps

1. **Discover cycling relations** — `relation["route"="bicycle"]` in bbox
2. **Discover named cycling ways** — cycleways, paths, bike lanes with names. Split same-named ways by connectivity (shared nodes + 100m endpoint snap + 2km bbox merge). Junction trail expansion for non-cycling connectors.
2b. **Discover unnamed parallel lanes** — `highway=cycleway` without names, chained by proximity, matched to nearby roads.
2c. **Discover unnamed cycling chains** — unnamed cycleways/paths >= 1.5km, named from nearby parks/roads using real geometry (`around.chain` + geometry-to-geometry distance).
3. **Build entries** — merge relations, named ways, parallel lanes, manual entries into one entry per path.
4. **Auto-group** — connectivity-based clustering (shared nodes, endpoint proximity). Park containment splits clusters by park. Spur absorption: clusters with only 1 page-worthy member (>= 1km) absorb the rest.
5. **Compute slugs** — centralized disambiguation.
6. **Superroute networks** — promoted sub-superroutes become networks. Top-level superroutes set `super_network` (sorted by scope: ncn < rcn < lcn, most specific wins). Same-named auto-group networks merged into promoted networks.
7. **Route-system networks** — `cycle_network` tag grouping.
8. **Wikidata enrichment** + MTB detection.
9. **Markdown overrides** — `member_of` from markdown frontmatter applied last, before zombie cleanup.
10. **Write YAML** — strip `_ways`, compact anchors, write.

## Taxonomy: Networks vs Paths

- **Path** — a single named cycling corridor with its own geometry (a `bike_paths` entry in bikepaths.yml). Gets a page if `type: destination`.
- **Network** — a collection of paths forming a coherent system (`type: network` in bikepaths.yml, with a `members` array of path slugs). Comes from OSM `type=superroute` relations or park containment auto-grouping. Members keep their own pages; the network is an additional layer above them.
- **`members` vs `grouped_from`** — `members` (networks) is additive: children keep their pages. `grouped_from` (trail clusters) is reductive: children lose their pages, absorbed into the group. Auto-grouping skips network members to prevent collision.
- **Primary network** — when a path belongs to multiple networks, `member_of` points to the primary (determines URL). The path can also appear in other networks' `members` arrays as a secondary member.
- **Only top-level superroutes become networks.** A sub-superroute (child of another superroute) is NOT a network — it's a path split into sections by OSM mappers. Exception: sub-superroutes with 3+ leaf routes get promoted (e.g. Ottawa River Pathway). Minimum 2 members in the bbox to qualify as a network.

## Clustering

The auto-grouping in `lib/cluster-entries.mjs` merges entries whose OSM ways share nodes or have endpoints within ~10m. It does NOT use anchor distance. Guards: operator compatibility, path type (trail/paved/road), corridor width (type-dependent: 20km trails, 3km paved, 2km road).

## Key Invariants

- `_ways` is transient — exists in memory during build, stripped before YAML output.
- Anchors are for Overpass name lookups only — never for spatial reasoning (see `~/code/bike-routes/_ctx/spatial-reasoning.md`).
- bikepaths.yml is the deliverable. Code changes without regenerating data are incomplete.
- The Astro app reads bikepaths.yml + markdown directly. Both must be correct.
- One slug function: `slugifyBikePathName` from `src/lib/bike-paths/bikepaths-yml.server.ts`. The pipeline imports it directly — no duplicates.

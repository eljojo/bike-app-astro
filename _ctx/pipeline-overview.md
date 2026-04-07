---
description: "How build-bikepaths.mjs discovers, names, clusters, and networks cycling infrastructure"
type: knowledge
triggers: [modifying the pipeline, debugging bikepaths.yml output, adding discovery steps, changing naming logic]
related: [spatial-reasoning, naming-unnamed-chains, markdown-overrides, entry-types, path-types]
---

# Pipeline Overview

`scripts/pipeline/build-bikepaths.mjs` builds bikepaths.yml from scratch every run (`make bikepaths`). No incremental merge.

## Steps

1. **Discover cycling relations** — `relation["route"="bicycle"]` and `relation["route"="mtb"]` in bbox
1b. **Claim relation member ways** — fetch member way IDs for all discovered relations via `out body;`. Register in the WayRegistry (`lib/way-registry.mjs`). These ways are "claimed" — named-way discovery will merge them into the relation entry instead of creating duplicates.
2. **Discover named cycling ways** — cycleways, paths, bike lanes with names. Split same-named ways by connectivity (shared nodes + 100m endpoint snap + 2km bbox merge). Junction trail expansion for non-cycling connectors. Way IDs (`_wayIds`) are preserved through splitting.
2b. **Discover unnamed parallel lanes** — `highway=cycleway` without names, chained by proximity, matched to nearby roads.
2c. **Discover unnamed cycling chains** — unnamed cycleways/paths >= 1.5km, named from nearby parks/roads using real geometry (`around.chain` + geometry-to-geometry distance).
2d. **Discover non-cycling relations** — walk UP from cycling ways to find hiking, skiing, and other route relations that share cycling infrastructure. These are NOT entries — they become `overlapping_relations` metadata on existing entries. Threshold: ≥2km bikeable.
3. **Build entries** — merge relations, named ways, parallel lanes, manual entries into one entry per path. Merge priority: way-ID overlap (WayRegistry) → slug match → name match. Relations claim their member ways first; named ways with ≥50% overlap merge into the claiming entry.
4. **Auto-group** — connectivity-based clustering (shared nodes, endpoint proximity). Park containment splits clusters by park. Spur absorption: clusters with only 1 page-worthy member (>= 1km) absorb the rest.
5. **Compute slugs** — centralized disambiguation.
6. **Superroute networks** — promoted sub-superroutes become networks. Top-level superroutes set `super_network` (sorted by scope: ncn < rcn < lcn, most specific wins). All leaf routes are members — same-named children are regular members, never absorbed into the network's `osm_relations`. Step 1 skips superroutes (they're containers for network discovery, not paths).
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

The auto-grouping in `lib/cluster-entries.ts` merges entries whose OSM ways share nodes or have endpoints within ~10m. It does NOT use anchor distance. Guards: operator compatibility, path type (trail/paved/road), corridor width (type-dependent: 20km trails, 3km paved, 2km road).

## Key Invariants

- `_ways` is transient — exists in memory during build, stripped before YAML output.
- `_discovery_source` is transient — set during entry building, stripped before YAML output. Values: `relation` (Step 1), `named-way` (Step 2), `unnamed-chain` (Step 2c), `parallel-lane` (Step 2b). Used by `deriveEntryType` for provenance-aware MTB classification.
- `osm_way_ids` persists in YAML — the OSM way IDs composing each entry. Provenance metadata: trace any entry back to its source ways.
- Way IDs are the merge key. Relations claim ways first. Named ways with ≥50% overlap merge into the relation entry. Names are display metadata, not structural keys.
- The WayRegistry (`lib/way-registry.mjs`) is the single source of truth for way ownership during the pipeline run.
- **Each OSM relation appears in exactly one entry's `osm_relations`.** Networks only carry their own superroute relation ID — never their members' relation IDs. Post-pipeline validation enforces this.
- Anchors are for Overpass name lookups only — never for spatial reasoning (see `_ctx/spatial-reasoning.md`).
- bikepaths.yml is the deliverable. Code changes without regenerating data are incomplete.
- The Astro app reads bikepaths.yml + markdown directly. Both must be correct.
- One slug function: `slugifyBikePathName` from `src/lib/bike-paths/bikepaths-yml.server.ts`. The pipeline imports it directly — no duplicates.

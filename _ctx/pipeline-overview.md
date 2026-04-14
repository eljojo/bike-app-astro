---
description: "How the bikepaths pipeline discovers, names, clusters, and networks cycling infrastructure — including engine architecture and trace workflow"
type: knowledge
triggers: [modifying the pipeline, debugging bikepaths.yml output, adding discovery steps, changing naming logic, adding phases, using trace]
related: [spatial-reasoning, naming-unnamed-chains, markdown-overrides, entry-types, path-types, pipeline-graph]
---

# Pipeline Overview

`scripts/pipeline/build-bikepaths.ts` builds bikepaths.yml from scratch every run (`make bikepaths`). No incremental merge.

## Steps

1. **Discover cycling relations** — `relation["route"="bicycle"]` and `relation["route"="mtb"]` in bbox. Non-cycling relations (hiking, skiing, piste, foot) that match the name-pattern clause are filtered out. Mega-MTB aggregations (>50 member ways, no ncn/rcn/ref) are also filtered — they're park-wide aggregations that eat individual named trails. The individual trails are better discovered as named ways in step 2.
1b. **Claim relation member ways** — fetch member way IDs for all discovered relations via `out body;`. Register in the WayRegistry (`lib/way-registry.mjs`). These ways are "claimed" — named-way discovery will merge them into the relation entry instead of creating duplicates.
2. **Discover named cycling ways** — cycleways, paths, bike lanes with names. Split same-named ways by connectivity (shared nodes + 100m endpoint snap + 2km bbox merge). Junction trail expansion for non-cycling connectors. Way IDs (`_wayIds`) are preserved through splitting.
2b. **Discover unnamed parallel lanes** — `highway=cycleway` without names, chained by proximity, matched to nearby roads.
2c. **Discover unnamed cycling chains** — unnamed cycleways/paths >= 1.5km, named from nearby parks/roads using real geometry (`around.chain` + geometry-to-geometry distance).
2d. **Discover non-cycling relations** — walk UP from cycling ways to find hiking, skiing, and other route relations that share cycling infrastructure. These are NOT entries — they become `overlapping_relations` metadata on existing entries. Threshold: ≥2km bikeable.
3. **Build entries** — merge relations, named ways, parallel lanes, manual entries into one entry per path. Merge priority: way-ID overlap (WayRegistry) → slug match → name match. Relations claim their member ways first; named ways with ≥50% overlap merge into the claiming entry.
4. **Auto-group** — connectivity-based clustering (shared nodes, endpoint proximity). Park containment splits clusters by park. Spur absorption: clusters with only 1 page-worthy member (>= 1km) absorb the rest.
5. **Compute slugs** — centralized disambiguation.
6. **Superroute networks** — promoted sub-superroutes become networks. Top-level superroutes set `super_network` (sorted by scope: ncn < rcn < lcn, most specific wins). All leaf routes are members — same-named children are regular members, never absorbed into the network's `osm_relations`. Step 1 skips superroutes (they're containers for network discovery, not paths).
7. **Route-system networks** — `cycle_network` tag grouping. Superroutes with a `cycle_network` tag are merged into the matching route-system network (e.g. CB2/CB5 superroutes → Ottawa Bikeways). This prevents duplicate networks and ensures members that lack their own `cycle_network` tag (e.g. Laurier Segregated Bikelane) get included via the superroute's membership.
8. **Wikidata enrichment** + MTB detection.
9. **Markdown overrides** — `member_of` from markdown frontmatter applied last, before zombie cleanup.
10. **Write YAML** — strip `_ways`, compact anchors, write.

## Taxonomy: Networks vs Paths

- **Path** — a single named cycling corridor with its own geometry (a `bike_paths` entry in bikepaths.yml). Gets a page if `type: destination`.
- **Network** — a collection of paths forming a coherent system (`type: network` in bikepaths.yml, with a `members` array of path slugs). Comes from OSM `type=superroute` relations or park containment auto-grouping. Members keep their own pages; the network is an additional layer above them.
- **`members` vs `grouped_from`** — `members` (networks) is additive: children keep their pages. `grouped_from` (trail clusters) is reductive: children lose their pages, absorbed into the group. Auto-grouping skips network members to prevent collision.
- **Primary network** — when a path belongs to multiple networks, `member_of` points to the primary (determines URL). The path can also appear in other networks' `members` arrays as a secondary member.
- **Only top-level superroutes become networks.** A sub-superroute (child of another superroute) is NOT a network — it's a path split into sections by OSM mappers. Exception: sub-superroutes with 3+ leaf routes AND distinct child names get promoted. Sub-superroutes whose children share the parent name (e.g. Ottawa River Pathway east/west/TCT) are organizational splits — flattened into the parent network. Redundant small superroutes (≤2 members sharing members with a larger network) are also removed. Minimum 2 members in the bbox to qualify as a network.

## Clustering

The auto-grouping in `lib/cluster-entries.ts` merges entries whose OSM ways share nodes or have endpoints within ~10m. It does NOT use anchor distance. Guards: operator compatibility, path type (trail/paved/road), corridor width (type-dependent: 20km trails, 3km paved, 2km road).

## Engine

The pipeline runs through a `TaskGraph` (`scripts/pipeline/engine/task-graph.ts`) — a DAG scheduler with bounded concurrency. Each pipeline step is a **phase** (`scripts/pipeline/phases/`), defined with explicit dependencies and a `produces` type annotation. The graph topologically sorts phases and runs independent ones in parallel (configurable via `OVERPASS_CONCURRENCY`, default 4).

The 5 discover phases run in parallel (they only need bbox + adapter). Everything from `assemble.entries` onward is sequential — each phase transforms the entries array. See `_ctx/pipeline-graph.md` for the auto-generated dependency graph with data-flow labels.

Each phase is a pure async function: `(inputs, ctx) => output`. Phases return new arrays; they do not alias the input array. Entry objects within may be shared across phase boundaries for reference integrity (`_networkRef`, `_memberRefs`).

### Trace

Per-subject decision tracing (`scripts/pipeline/engine/trace.ts`). Phases call `ctx.trace(subjectId, kind, data?)` at decision points — filter, merge, classify, promote, drop. The trace records a timeline per OSM subject (way, relation, entry).

- `make bikepaths --trace way:278992292` — print timeline for one subject
- `TRACE=off make bikepaths` — disable tracing
- Trace dump: `~/code/bike-routes/<city>/.pipeline-debug/trace.json`

Subject namespaces: `way:N` (OSM way), `relation:N` (OSM relation), `entry:slug` (bikepaths.yml entry).

### Adding a phase

1. Create `scripts/pipeline/phases/<name>.ts` with the `Phase<Inputs, Output>` signature
2. Add a `graph.define()` call in `build-bikepaths.ts` with `deps` and `produces`
3. The auto-generated `_ctx/pipeline-graph.md` updates on the next `make bikepaths` run

### Historical bug clusters

Some phases have concentrated bug histories — the phase headers document what to watch for:
- **assemble.entries**: tag-bleeding regressions (Adàwe), discovery-source misclassification
- **resolve.networks**: hierarchy inversion, networks absorbing children's relation IDs
- **resolve.classification**: entry type misclassification, non-cycling promotion thresholds

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

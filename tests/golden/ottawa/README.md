# Ottawa — Golden Information Architecture

Editorial source of truth for what the `/bike-paths` index SHOULD look like.
Curated by humans, read by tests. When the classifier drifts from this,
tests fail with actionable diffs. When the golden standard changes, these
files are edited deliberately.

## Files

Read them in this order — each is independently reviewable in one sitting.

1. **`01-pathways.yaml`** — paved MUPs, off-street, family-friendly. 3 networks (+ a new Parc de la Gatineau pathway network) + standalones.
2. **`02-bikeways.yaml`** — urban utility, protected on-street. 1 real network + 1 proposed (Gatineau).
3. **`03-local-trails.yaml`** — rail trails and day-destination rides. Standalones only. The "Local Trails" tab.
4. **`04-long-distance.yaml`** — big multi-day trails (TCT Ontario, Sentier Trans-Canada Québec, Route Verte 1, Le P'tit Train du Nord). The "Long Distance Trails" tab — split from Local Trails per user editorial. Stage 2 pending assertions live here.
5. **`05-mtb.yaml`** — dirt, purpose-built, technical. 8 networks, heavy on tier-2 overflow. The biggest file.
6. **`06-everything-else.yaml`** — cross-cutting diagnostic: `filter_out`, `slug_deduplications`, `renames`, `reclassifications`, `cross_memberships`, `related_networks_mutual`, `segments_expectations`, `city_bounds_expectations`, `needs_review`.

## How tests use this

The test runner loads all six files and deep-merges them into a single golden object. Each file covers a disjoint section of the schema — `tabs.pathways` lives only in 01, `tabs.mtb` only in 05, etc. — so merging never conflicts.

`needs_review` in file 06 is the editorial checklist. When it's empty, the golden file is ratified.

Stage 2 assertions (in `04-long-distance.yaml`'s `stage_2_pending`) are marked `stage: 2` and skipped in CI until the Stage 2 decomposition work ships. Before the mega branch merges to main, no skipped assertions remain.

## Vocabulary

- **tab** — kind of riding. Five tabs: `pathways` / `bikeways` / `local_trails` / `long_distance_trails` / `mtb`. Note: the "trails" concept is split into two tabs because a day-trip trail and a multi-day trail serve very different planning questions.
- **network** — named grouping a cyclist recognizes (optional)
- **path** — ride planning unit (has its own detail page)
- **segment** — orientation unit inside a path (no detail page)
- **container_type** — `pathway_system` | `park` | `long_distance_trail`

Full taxonomy lives at `_ctx/bike-paths.md`.

## Design doc

`~/code/bike-app/docs/plans/2026-04-15-phase-2-pageless-segments-design.md`

---
description: "mergeWayTags loses minority tag values — paths need mixed-surface/mixed-width facts like networks already have"
type: knowledge
triggers: [working with mergeWayTags, surface facts, width facts, path detail facts, mixed surface]
related: [pipeline-overview, bike-paths, path-types]
---

# Tag Merge Losses

## The Problem

`mergeWayTags` in `build-bikepaths.mjs` picks the most common value for each OSM tag across all ways in an entry. When a path has mixed surfaces (e.g. Watts Creek: asphalt + unpaved + ground + fine_gravel), only the majority value survives. The minority values are lost.

This matters for physical tags that directly affect ride planning: `surface`, `width`, `lit`, `smoothness`.

## Current State

The `[tag-merge]` log line fires when >30% of ways disagree on a physical tag. Running the pipeline on Ottawa produces ~150 lossy merges. Notable examples:

- **Watts Creek Pathway**: reported as "asphalt" but has significant unpaved/ground/fine_gravel sections
- **Véloroute des Grandes Fourches**: "asphalt" wins with 1889/2818 ways — 929 ways across 13 surface types are lost
- **Sentier des Pionniers**: `lit` is nearly 50/50 yes/no — reported as "yes"

## The Insight

The facts system already handles this for **networks** — aggregating member surfaces with unanimous/partial/mixed consistency breakdowns. Individual entries composed of multiple ways need the same treatment. A path isn't "asphalt" or "gravel" — it's "3.2 km asphalt, 1.1 km fine gravel, 0.3 km boardwalk."

## Future Direction

Instead of picking a winner, `mergeWayTags` should preserve the distribution for physical tags. The facts engine can then render the same unanimous/partial/mixed pattern it already uses for networks. This requires:

1. Storing per-way tag distributions (or at least per-tag breakdowns) on entries
2. Extending the facts rendering to handle individual entries, not just networks
3. Ideally weighting by way length, not way count

### Lit needs its own "mixed"

Boolean tags like `lit` can't use the surface consistency pattern directly. A path that's lit for half its length and unlit for the other half isn't "lit: yes" or "lit: no" — it's "partially lit." This needs a dedicated representation: e.g. `lit: partial` or a breakdown like "2.1 km lit, 1.4 km unlit."

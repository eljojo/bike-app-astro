---
description: "mergeWayTags propagation rules — per-segment tags need majority-km coverage of the entry, not just presence"
type: knowledge
triggers: [working with mergeWayTags, pipeline tag bleed, per-segment tag leaking to entry, piste tag on bike path, tunnel on long trail]
related: [tag-merge-losses, pipeline-overview, debugging-pipeline-data]
---

# Tag Propagation

## The Principle

When `mergeWayTags` merges a cluster of ways into a single entry, not every OSM tag describes the entry as a whole. Some tags describe the nature of a specific way or segment, and propagating them up as if they were entry-level facts produces misleading data.

Always ask: *if this tag is true for one way out of ten, is it still true for the entry?*

## Three Categories of Tags

### 1. Identity tags — skipped on way-to-relation merges
`name`, `ref`, `operator`, `network`, `wikidata`, `wikipedia`, `distance`, `description`. These describe the entity, not its physical makeup. `mergeWayTags` still picks a majority, but `enrichEntry({ skipIdentity: true })` prevents way identities from overwriting a relation's identity.

### 2. Entry-wide physical tags — majority wins, with distributions for mixed cases
`highway`, `surface`, `width`, `smoothness`, `lit`, `incline`, `segregated`. These usually apply to every way in a cluster, so km-weighted majority is meaningful. When values disagree, `surface_mix` / `lit_mix` capture the distribution (see `_ctx/tag-merge-losses.md`). The `[tag-merge]` loss warning fires when <70% of tagged km agrees.

### 3. Per-segment characterization tags — majority-of-entry required
A fact about one way that would lie if applied to the entry as a whole. These need to cover **at least 50% of the entry's total length** to propagate. Below that threshold, the tag is dropped with a `[tag-merge] dropped minority` log line.

Current per-segment set (`PER_SEGMENT_TAGS` in `scripts/pipeline/lib/osm-tags.ts`):

| Tag | Why per-segment |
|---|---|
| `piste:type`, `piste:name`, `piste:difficulty`, `piste:grooming`, `piste:ref` | One groomed segment of a trail does not make the whole trail a piste |
| `ski`, `snowmobile`, `horse` | Access tags for modes that are usually per-segment in practice |
| `tunnel` | A single tunneled segment does not make the corridor a tunnel |
| `bridge` | Same |
| `ford`, `embankment`, `cutting` | Same — structural per-segment features |
| `railway`, `abandoned:railway` | Rail heritage is a per-segment fact, not entry identity |

Access tags `bicycle` and `foot` are intentionally **not** in this set. Their semantics are asymmetric: `bicycle=no` on any single way is a real access concern that deserves propagation, and `bicycle=designated` on a minority way commonly indicates a legal cycling corridor even if most segments are untagged. The belt-and-suspenders check in `deriveEntryType` handles `bicycle=no` as its own signal.

## The Denominator Matters

The bug this rule fixes is subtle. Before, `mergeWayTags` computed majority-agreement *within ways that had the tag*:

```text
tagKm['piste:type'] = { nordic: 0.2 km }
bestKm / totalKm(tag) = 0.2 / 0.2 = 100%   ← looks unanimous!
```

But the entry was 0.6 km long. The tag only covered 33% of the entry. The 100% figure described agreement between tagged ways, not coverage of the entry.

The fix uses `entryTotalKm` (sum of all ways' km, regardless of whether they have the tag) as the denominator for per-segment tags:

```text
bestKm / entryTotalKm = 0.2 / 0.6 = 33%   ← below 50% threshold, drop
```

Other categories still use the existing per-tag denominator — they behave the same as before.

## When to Add a Tag to PER_SEGMENT_TAGS

Add a tag when:
- It describes a localised physical or functional feature (tunnel, bridge, piste grooming)
- Consumers of the entry would interpret the tag as entry-wide truth
- Its presence on a minority of ways has caused wrong downstream classification

Do *not* add a tag when:
- It's an access tag with asymmetric semantics (`bicycle`, `foot`, `motor_vehicle`)
- It describes a feature that's genuinely entry-wide even if tagged on one way (e.g. `operator` — one way tagged with the operator usually means the whole path is operated by them)
- Consumers already know to treat the tag as distributional (`surface`, `lit` via `_mix`)

## Log Lines

`mergeWayTags` emits two kinds of diagnostic logs:

- `[tag-merge] Path Name: <key>: picked "<val>"(X/Y km), lost <alts>` — a physical tag had disagreement; the loss warning still fires as before.
- `[tag-merge] Path Name: dropped minority <key>="<val>" (N% of entry)` — a per-segment tag had insufficient coverage and was dropped. Useful when investigating why an entry "lost" a tag it used to have.

## Related Failures This Prevents

- Dewberry Trail (Mer Bleue Bog, Ottawa) had 1 of 3 ways tagged `piste:type=nordic`. Before the threshold, the merged entry carried `piste:type=nordic`, which tripped the belt-and-suspenders check in `deriveEntryType` and downgraded a legitimate destination trail to `connector`. After the threshold, the tag is dropped (33% of entry) and the entry keeps `type: destination`.
- Any mixed rail-trail where only part of the corridor follows the old rail bed no longer picks up `abandoned:railway=rail` as an entry-level identity.
- Any entry with a single tunneled or bridged segment no longer claims `tunnel=yes` or `bridge=yes` as an entry-wide fact.

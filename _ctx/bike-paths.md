---
description: How bikepaths.yml (OSM) and markdown files cooperate — overlay model, network resolution, page generation
type: pattern
triggers: [working with bike paths, modifying bike-path-entries, changing network pages, debugging path page generation, adding bike path features]
related: [content-model, architecture-principles, virtual-modules]
---

# Bike Paths — Two-Layer Data Model

Bike path data comes from two sources that cooperate like layers in a map:

1. **`bikepaths.yml`** (OSM layer) — structure, geometry, networks, surface, width. Bulk-imported from OpenStreetMap. This is the base truth about what physically exists.
2. **Markdown files** (`bike-paths/*.md`) — human-curated content. Names, descriptions, vibes, photos, tags. These are overlays on top of the OSM layer.

The markdown never replaces the YML — it enriches it. A markdown file for a network path should produce a network page with better content, not a standalone page that erases the network structure.

## How They Merge

`bike-path-entries.server.ts` is the single authority that reads both sources and produces `BikePathPage[]`. Everything downstream — views, virtual modules, enrichment — queries this one list. Nothing else should know about the two-source split.

### Processing Order

1. **Parse YML** — every entry gets a slug derived from its name
2. **Markdown claims entries** — a markdown file matches its YML entry by slug (or via explicit `includes:` for multi-entry pages). Claimed entries gain the markdown's content (name, body, vibe, photos)
3. **Unclaimed YML entries** — become YML-only standalone pages (scored, filtered)
4. **Network entries** (`type: network`) — build network pages with `memberRefs`, aggregating geometry from members

### The Overlay Rule

When a markdown file's slug matches a YML entry:
- **Structure comes from YML**: `type`, `members`, `member_of`, `osm_relations`, `surface`, `anchors`
- **Content comes from markdown**: `name`, `body`, `vibe`, `photo_key`, `tags`, `featured`
- **Markdown `includes:`** can override which YML entries are grouped together

This applies regardless of YML entry type. A markdown matching a `type: network` entry should produce a network page enriched with the markdown content — not a standalone page.

## Networks

A network is a group of connected paths that share a real-world identity (a park trail system, a greenway corridor).

### Multi-Network Membership

A path can belong to multiple networks. Watts Creek Pathway is physically part of both the NCC Greenbelt and Capital Pathway — this is a fact about the world, not a data error.

Each path has one **primary network** (`member_of` in YML / `memberOf` on `BikePathPage`). The primary network determines the path's URL: `/bike-paths/{primary-network}/{slug}`. Only one page is generated per path — under its primary network.

A path can also appear in other networks' `members` arrays as a **secondary member**. Secondary members are listed on the network page but their links point to the path's primary network URL (where the page actually lives).

### YML Structure

```yaml
# Network A — primary network for klondike
- name: South March Highlands Conservation Forest
  type: network
  members: [klondike, porcupine, brady, ...]

# Network B — also lists klondike (secondary member here)
- name: Capital Pathway
  type: network
  members: [klondike, experimental-farm, ...]

# Path — primary network is south-march-highlands
- name: Klondike
  member_of: south-march-highlands-conservation-forest
```

### Network Pages

Network pages aggregate from their members: geometry, overlapping routes, nearby photos, nearby places. Members with `standalone: true` get their own sub-pages at `/bike-paths/{network}/{member}`.

The `memberOf` field on a path page is the **primary network** — it controls the path's URL. The path's page lives at `/bike-paths/{memberOf}/{slug}`. If a network fails validation (< 2 members, no standalone members), `memberOf` is cleared and members become flat standalone pages.

When rendering a network's member list, use `m.memberOf` (the member's primary network) to construct URLs — not the current network's slug. For primary members, `m.memberOf === net.slug` so this is the same. For secondary members, `m.memberOf` points to a different network where the page actually lives. Using `net.slug` instead produces broken links.

## Enrichment Pipeline

`bike-path-relations.server.ts` computes spatial relationships (connected paths, nearby paths, route overlaps, nearby places/photos) in two passes:

1. **Pass 1**: compute relations for each page's own YML entries
2. **Pass 2**: aggregate member relations into network pages

The enrichment layer doesn't know about markdown vs YML — it works on the merged `BikePathPage[]`.

## Connected Paths

Two paths "connect" if their endpoints are within 200m. On a page, connected paths are grouped by network — if 5 connected paths belong to network X, they show as "X — 5 pathways" instead of 5 individual links. The page excludes its own members and paths belonging to its own network from the "Connects to" section.

## Page Types and Views

All three page types render through a single shared component (`src/views/paths/BikePathDetail.astro`). Three thin route shells handle `getStaticPaths()` and pass props:

| Condition | Route Shell | URL |
|-----------|-------------|-----|
| Standalone, no network | `detail.astro` | `/bike-paths/{slug}` |
| Network page | `network-detail.astro` | `/bike-paths/{network}` |
| Member of network, standalone | `member-detail.astro` | `/bike-paths/{network}/{slug}` |

`BikePathDetail` derives the page type from the data itself:
- `page.memberRefs?.length > 0` → network layout (full-width map, member list, wikidata facts)
- `page.memberOf` → member layout (network badge, breadcrumb to parent)
- Neither → standalone layout

Route shells own data loading and param shapes. The shared component owns all rendering.

All three routes are registered via `injectRoute()` in `i18n-routes.ts`. Route ordering matters — the member route (two segments) must precede the network route (one segment) which must precede the standalone route (one segment).

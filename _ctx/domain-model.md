---
description: The cycling domain — entities, relationships, and why modelling reality truthfully produces better software
type: knowledge
triggers: [adding content types, naming things, designing features, choosing data structures, deciding where data lives]
related: [content-model, instance-types, architecture-principles, development-principles]
---

# Domain Model

## The Principle

The codebase models cycling reality. Not application concepts, not database tables, not UI components — the actual things cyclists talk about and care about. Routes, rides, tours, events, places, waypoints, organisers. These aren't arbitrary labels. They're how cyclists already think.

By modelling life truthfully, the software serves human needs. When the domain model is right, features follow naturally — a "nearby places" feature just works because places have coordinates and routes have tracks. When the model is wrong, every feature is a workaround. This is self-reinforcing: good domain modelling makes good features easy, which makes the product better for cyclists, which attracts more cyclists who contribute more knowledge, which makes the model richer.

Name things what cyclists call them. If a concept needs a workaround to fit the model, the model might need to grow.

## The Entities

### Route
A cycling route curated by the community. Has a track (GPX), description, photos, tags, difficulty score, nearby places, and variants (alternative GPX files for the same route). Routes are the core entity of the wiki instance.

### Ride
A personal cycling record. Same underlying infrastructure as routes (same content collection, same virtual modules, same editor pipeline), but ride-specific: date from directory path, elapsed/moving time from GPX, optional Strava import. Rides are the core entity of the blog instance.

### Tour
A multi-day ride collection detected from directory structure — not a separate content type but an aggregation. Any non-numeric directory within a year becomes a tour. Tours have total distance, date range, and a list of rides.

### Event
A cycling event — a group ride, a workshop, a race, a community meetup. Events have dates, organizers, optional routes with waypoints, and results (for club instances). Events can form series with recurring dates.

### Place
A point of interest relevant to cyclists — a cafe, a viewpoint, a swimming spot, a bike shop, a park entrance. Places have coordinates, categories, and appear on route pages when they're nearby. Places are why people ride.

### Waypoint
A checkpoint or point of interest along an event route. Waypoints have coordinates, opening/closing times (for randonneuring controls), and notes. They're distinct from places — a waypoint is event-specific, a place is permanent.

### Organiser (Community)
A cycling organisation, club, or community group. Organisers host events. In the UI they're called "communities" — the domain term and the user-facing term diverge here because "organiser" is the data concept and "community" is what riders relate to.

### Bike Path
A segment of cycling infrastructure with its OSM identity. Bike paths have geometry (GeoJSON from Overpass), surface type, lighting, separation, and scoring. They can be standalone or members of a network. The `bikepaths.yml` file is the city's cycling infrastructure registry.

### Guide
A long-form article about cycling in the city — seasonal tips, how-to guides, route collections. Guides are the editorial layer.

### Page
A generic static page (about, etc.). The simplest content type.

## Relationships

```
Organiser ──hosts──▶ Event ──has──▶ Waypoint
                       │                │
                       │ optional        │ references
                       ▼                ▼
                     Route ◀──nearby── Place
                       │
                       │ (blog)
                       ▼
                     Ride ──groups into──▶ Tour

Bike Path ──member of──▶ Network (another Bike Path with type: network)
Route ──overlaps──▶ Bike Path
```

- Routes have nearby places (computed at build time from track proximity)
- Events reference organisers and optionally have routes with waypoints
- Rides are personal routes that group into tours by directory structure
- Bike paths form networks and overlap with routes
- Guides and pages are standalone — they reference routes/events by linking, not by data relationship

## Model Boundaries

### Content Model (source of truth)
Model files in `src/lib/models/` define the canonical schemas. Collection schemas in `src/schemas/index.ts` import from them. Every entity's shape is defined once. See `_ctx/content-model.md`.

### Admin Model (cache overlay)
Admin pages use build-time virtual module data overlaid with D1 cache entries. The admin model is a view of the content model optimised for editing, not a separate model.

### Build-Time Insights (computed views)
Difficulty scores, similarity matrices, nearby places, route shape classification — these are computed at build time from the full dataset. They're derived data, not domain entities. They live in static HTML, never in the content repo.

## Tags as Domain Extension

Tags are how the domain model grows without schema changes. A tag can recontextualise an entity — `bike-shop` on an organiser turns it from a community into a shop listing. `family-friendly` on a route changes how it's presented. Tags combine: `bike-shop` + `mobile` means no physical location.

A tag is data the community can edit. A schema field is structure only a developer can change. Prefer tags for behavioural variations.

## Instance Type Determines Active Entities

Not all entities are active in all instances:

| Entity | Wiki | Blog | Club |
|--------|------|------|------|
| Route | yes | — | yes |
| Ride | — | yes | — |
| Tour | — | yes | — |
| Event | yes | — | yes |
| Place | yes | — | yes |
| Waypoint | — | — | yes |
| Organiser | yes | — | yes |
| Bike Path | yes | — | — |
| Guide | yes | — | — |

Use `getInstanceFeatures()` for capability checks, not entity existence checks.

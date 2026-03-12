---
title: Club instance
description: Run a cycling club event archive powered by the whereto.bike engine.
---

:::caution[Experimental]
The club instance type is experimental. Data formats, page layouts, and admin features may change between releases. The core event/route/place pipeline works, but expect rough edges.
:::

A club instance turns the whereto.bike engine into an event archive for cycling organizations — randonneuring clubs, brevets, audax groups, or any club that organizes rides with checkpoints, time limits, and results.

## What it does

Club instances add event-centric features on top of the standard route catalog:

- **Enriched events** — events reference routes, waypoints (checkpoints with opening/closing times, danger zones, POIs), registration metadata (price, slots, deadline, departure groups), and results with ACP homologation numbers
- **Event detail page** — poster hero, info card with registration CTA, interactive route map with multi-route selector, elevation profile with waypoint tick marks, waypoint timeline, FAQ accordion, results table with privacy-aware name formatting
- **Route map integration** — events display referenced routes on an interactive map with color-coded polylines and waypoint markers (checkpoint circles, danger triangles, POI dots)
- **Interactive elevation** — SVG elevation chart with hover tooltip, map cursor sync (dot follows your mouse along the route on the map), collapsible toggle, and waypoint tick marks at km positions
- **Results table** — finishers sorted by time with homologation numbers, non-finishers in a collapsible section, privacy filtering (full name, last name only, or initials) controlled by city config
- **GPX downloads** — event-specific GPX files with waypoints injected as `<wpt>` elements
- **Club navigation** — Events, Routes, Places, About (replaces the wiki's calendar/map nav)
- **Club footer** — club name with optional ACP club code

## How it works

Set `instance_type: club` in your city's `config.yml`:

```yaml
instance_type: club
name: My Club
display_name: My Brevet Club
acp_club_code: XX0001
results_privacy: full_name  # full_name | last_name_only | initials
```

### Event data structure

Club events use the standard event markdown format with additional frontmatter fields:

```yaml
---
name: BRM 300 Coastal Loop
start_date: "2024-03-15"
start_time: "06:00"
end_date: "2024-03-16"
time_limit_hours: 20
location: Plaza Italia, Santiago
organizer: my-club
distances: "300 km"
routes:
  - coastal-loop-300
waypoints:
  - place: control-village
    type: checkpoint
    label: CP1 Village
    distance_km: 85
    opening: "08:30"
    closing: "11:40"
  - place: danger-descent
    type: danger
    label: Steep descent
    distance_km: 120
registration:
  url: https://example.com/register
  slots: 80
  price: "$15.000 CLP"
  deadline: "2024-03-10"
  departure_groups:
    - "06:00 - Group A"
    - "06:30 - Group B"
results:
  - brevet_no: 101
    last_name: García
    first_name: Carlos
    time: "14h32m"
    homologation: "ACP-2024-001"
  - brevet_no: 104
    last_name: Morales
    status: DNF
gpx_include_waypoints: true
---

Event description in markdown. Use `## FAQ` followed by `### Question?` headings for an automatic accordion.
```

### Waypoint types

- **checkpoint** — control point with opening/closing times. Rendered as colored circles on the map and purple tick marks on the elevation chart.
- **danger** — hazard warning (steep descent, rough road, etc.). Rendered as red triangles on the map.
- **poi** — point of interest (scenic viewpoint, water stop). Rendered as blue circles on the map.

Waypoints reference places from the places collection by ID. The place provides the lat/lng coordinates; the waypoint adds event-specific metadata (label, times, distance).

### Routes and places

Club instances use the same routes and places collections as the wiki. Routes need GPX tracks with elevation data for the interactive elevation profile to work.

## Admin features

The club event editor extends the standard event editor with:

- **Route selector** — pick routes from the collection, preview on map
- **Waypoint editor** — add waypoints with place search, auto-suggest nearby places along the route, set checkpoint times
- **Results editor** — import results from CSV, inline editing, sort by time
- **Media gallery** — directory-based events support a `media.yml` sidecar for photos

## Config reference

Club-specific fields in `config.yml`:

| Field | Type | Description |
|-------|------|-------------|
| `instance_type` | `"club"` | Required. Enables club features. |
| `acp_club_code` | `string` | Optional. Displayed in footer. |
| `results_privacy` | `"full_name" \| "last_name_only" \| "initials"` | How participant names appear in results tables. Defaults to `full_name`. |

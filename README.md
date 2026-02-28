# Ottawa by Bike — Astro

Static site rebuild of [ottawabybike.ca](https://ottawabybike.ca) using [Astro](https://astro.build/).

Replaces the Rails app with a fully static site generated from exported content data (routes, guides, events, places).

## Stack

- **Astro** — static site generator
- **Leaflet** — interactive maps
- **Playwright** — screenshot regression tests
- **Sharp** — image processing for map thumbnails

## Getting started

```sh
nix develop
npm install
npm run dev
```

## Data

Route data lives in a separate `bike-routes` content repository and is loaded via Astro content collections.

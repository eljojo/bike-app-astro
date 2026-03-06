# Ottawa by Bike

A curated guide to cycling routes in the National Capital Region — [ottawabybike.ca](https://ottawabybike.ca)

Created by [José Albornoz](https://eljojo.net), Ottawa by Bike helps cyclists of all levels discover beautiful routes, with photos, videos, GPX downloads, and personal tips like the best snack spots and detour alerts.

The long-term vision is a "Wikipedia of bike routes" — a community-driven, openly-licensed cycling knowledge base designed for multi-city deployment.

## Architecture

**Two repos, one site:**

1. **[bike-routes](https://github.com/eljojo/bike-routes)** — Markdown + GPX data organized by city. The cycling wiki. Forkable, usable by any tool.
2. **This repo** — Astro app that renders one city's data into a static website.

The build has zero external dependencies — it reads only the data repo. Works on a train.

## Stack

- **[Astro](https://astro.build)** — static site generator (TypeScript)
- **[Cloudflare Workers](https://workers.cloudflare.com)** — deployment (static assets on CDN)
- **[Leaflet](https://leafletjs.com)** — interactive maps with Thunderforest Cycle tiles
- **[PhotoSwipe](https://photoswipe.com)** — photo galleries
- **[Playwright](https://playwright.dev)** — screenshot regression tests
- **[Plausible](https://plausible.io)** — privacy-friendly analytics

## Getting started

```sh
nix develop
npm install
npm run dev
```

## Data

Route data lives in the separate [`bike-routes`](https://github.com/eljojo/bike-routes) repository and is loaded via Astro content collections. The data repo path is configured in `src/content.config.ts`.

## History

This site was originally built as a Ruby on Rails application. The old Rails codebase is archived at [bike-app-archive](https://github.com/eljojo/bike-app-archive).

## License

This application is licensed under the [GNU Affero General Public License v3.0](LICENSE).

The content data in [`bike-routes`](https://github.com/eljojo/bike-routes) is licensed separately:
- Text: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Route data (GPX): [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)
- Media: per-file licensing

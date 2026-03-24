# where to bike 🚲

Open-source cycling platform — one codebase, three modes: community route wiki, personal ride blog, cycling club archive. The WordPress for cycling.

## Why this exists

Someone who loves cycling wants to share it with someone they care about. They're looking for the right ride — somewhere worth going, not too far, good surface. Maybe there's a bakery at the turnaround point, or a lookout over the river, or a swimming spot for after.

They need the information to be truthful, because this is how cycling clicks for a new person. Not through arguments or marketing, but through one good ride. If the distance is off, if the surface info is missing, if nobody mentioned the hill — that ride goes differently. And someone who could have discovered that a bicycle is freedom might not try again.

That's what this software carries. The right information, from people who were actually there, available to anyone.

## Three instance types

**Wiki** — A cycling wiki for a city. Routes with GPS maps and photos, an event calendar, places worth riding to. Anyone can edit, like Wikipedia. [ottawabybike.ca](https://ottawabybike.ca) is the first one running.

**Blog** — A personal ride journal. Rides organized by date, photo galleries, multi-day tours. No algorithmic feed, just a website that's yours. [eljojo.bike](https://eljojo.bike) is the first one running.

**Club** — An event archive for cycling clubs. Group rides, races, brevets, results. The kind of institutional memory that usually lives in someone's filing cabinet or a spreadsheet that hasn't been updated since 2019.

## How it works

Anyone can edit any page — tap edit, make your changes, save. You don't need an account. If you want to be credited, you can create one with a passkey, but it's not required. Every edit is tracked with full history, and admins can revert anything with one click. It works like Wikipedia.

The site itself is fast and always online. Pages are pre-built as plain HTML, so they load quickly and don't depend on a server being up. When someone saves an edit, the site rebuilds automatically and the change is live in a few minutes.

The system also figures out things that would be tedious to maintain by hand — which routes are similar to each other, what's nearby, how difficult a route is compared to everything else on the site. That all happens automatically when the site rebuilds.

All content is stored in open formats — Markdown, GPS files, plain data files. Nothing is locked into the platform. If whereto.bike disappeared tomorrow, you'd still have everything.

## Bring it to your city

If you know your city's good rides and want to share them, you can have a cycling wiki running at `{yourcity}.whereto.bike` — routes, maps, photos, events, places worth riding to, community editing, multilingual. The people who ride there maintain it together.

[Get in touch](mailto:bike@eljojo.net) to get started.

## Under the hood

The public site is static HTML built by [Astro](https://astro.build). But Astro also supports server-rendered pages on the same component model — so the same `.astro` components that build static route pages also power the admin interface: the route editor, the event importer, the media manager. These run on [Cloudflare Workers](https://workers.cloudflare.com), serverless, no traditional server to maintain.

An event page is static HTML for the 99% of visits that just read it, and server-rendered for the admin previewing a draft. One component, both contexts. No separate frontend app, no API layer between the site and its editing tools.

When someone saves an edit, it commits to Git and triggers a rebuild. Content lives in the repo as Markdown, YAML, and GPX files. The build sees the entire dataset at once and computes things individual pages can't — route similarity, difficulty scoring relative to the whole collection, nearby places, which routes share the same roads. All of that gets frozen into static HTML.

## Getting started

```sh
nix develop        # enter dev shell
make install       # install dependencies
make dev           # dev server on localhost:4321
```

Route data lives in a separate content repository — plain Markdown, YAML, and GPX files. See the [docs](https://docs.whereto.bike) for the full setup guide, architecture reference, and API documentation.

## Built with

- [Astro](https://astro.build) — static site generation and server-rendered pages
- [Preact](https://preactjs.com) — interactive islands (editor, media manager, maps)
- [Cloudflare Workers](https://workers.cloudflare.com) — serverless deployment
- [MapLibre GL JS](https://maplibre.org) — vector tile maps
- [Thunderforest](https://www.thunderforest.com) — cycling-focused map tiles ([outdoors-v2](https://www.thunderforest.com/docs/thunderforest.outdoors-v2/))
- [OpenStreetMap](https://www.openstreetmap.org/copyright) — underlying map data
- [PhotoSwipe](https://photoswipe.com) — photo galleries
- [Drizzle ORM](https://orm.drizzle.team) — database layer (Cloudflare D1)
- [Plausible](https://plausible.io) — privacy-friendly analytics
- [Playwright](https://playwright.dev) — screenshot regression tests
- [Phosphor Icons](https://phosphoricons.com) — icon set

## License

The platform is licensed under the [GNU Affero General Public License v3.0](LICENSE).

Content data is licensed separately:
- Text: [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/)
- Route data (GPX): [ODbL 1.0](https://opendatacommons.org/licenses/odbl/)
- Photos: per-contributor licensing (CC BY-SA 4.0 default)

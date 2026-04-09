---
description: Blog city is always blog/, CITY=blog, consumer repo pattern, sync.js, how rides differ from routes
type: knowledge
triggers: [working on blog features, blog deployment, ride editor, blog-specific content, consumer repos]
related: [instance-types, save-pipeline, content-model]
---

# Blog Instance

## Key Facts

- Blog city folder is always `blog/` — no username-based naming.
- `CITY=blog` in all contexts (CI, deploy, local dev).
- Consumer repo: `~/code/bike-blog` (eljojo.bike instance).
- `create-bike-blog` scaffolds to `blog/`, sync reads `blog/config.yml` for domain.

## How Rides Differ from Routes

Rides reuse the routes infrastructure — same content collection, same virtual modules, same editor pipeline. The admin-rides loader populates route modules on blog instances. Key differences:

- Directory-driven structure: date from path (`YYYY/MM/DD-name.gpx`), no `index.md` + directory per ride.
- Optional sidecar files: `DD-name.md` for metadata, `DD-name-media.yml` for photos.
- GPX-computed fields: `elapsed_time_s`, `moving_time_s`, `average_speed_kmh`, `ride_date`.
- Downsampled to 200 points per ride to prevent OOM with large collections.
- Tours detected from directory structure — any non-numeric directory within a year becomes a tour.

## Consumer Repo Pattern

Blog instances consume bike-app-astro as an npm package. The consumer repo has:

- `astro.config.mjs` that imports `wheretoBike()` from the package
- `content.config.ts` using package loaders
- `blog/config.yml` with domain, timezone, locale

## Deploying Blog Changes

After pushing changes to bike-app-astro that affect the blog:

```sh
cd ~/code/bike-blog && git pull && \
  nix develop ~/code/bike-app-astro --command bash -c \
  "npm update bike-app-astro && node node_modules/bike-app-astro/sync.js && \
  git add . && git commit -m 'update blog' && git push"
```

## Sync Mechanism

`sync.js` keeps template-derived files (CI workflows, middleware, content config, tsconfig) in sync between the package and consumer repos. Reads `blog/config.yml` for domain/timezone substitution.

---
title: Bring it to your city
description: How to start a whereto.bike cycling guide for your city.
---

:::note
Multi-city support is under active development. This page describes the vision — some pieces aren't ready yet.
:::

## What you need

1. **Knowledge of your city's cycling routes.** You don't need to map every route on day one — start with 5-10 that you know well.
2. **Photos.** Real photos from real rides. Phone photos are perfect.
3. **GPX tracks.** Record your rides with any cycling app. Download the GPX files.
4. **Basic comfort with Git.** Content is managed through a Git repository.

## What you get

- A complete cycling guide website at `{yourcity}.whereto.bike`
- Community editing tools so local riders can contribute
- GPS track hosting and interactive maps
- Photo galleries with automatic resizing
- Event calendar for local cycling events
- Bilingual support (any two languages)

## How to get started

The platform is open source. You can:

1. **Self-host** — Fork the repos, deploy anywhere. Full instructions in the [GitHub repository](https://github.com/eljojo/bike-app-astro).
2. **Join the network** — We're working on making it easy to add new cities to the whereto.bike network. If you're interested, [open an issue on GitHub](https://github.com/eljojo/bike-app-astro/issues).

## Technical requirements

- **Hosting:** Any static hosting (Cloudflare Pages, Netlify, Vercel, GitHub Pages)
- **Media storage:** S3-compatible storage for photos (Cloudflare R2, AWS S3, MinIO)
- **Admin backend:** Cloudflare Workers or Node.js server
- **Domain:** Your own domain or a `{city}.whereto.bike` subdomain

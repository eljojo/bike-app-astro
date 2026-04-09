---
description: Static is Sacred, Develop on a Train, Universal Media, Data Locality, Data Insights, Tags as Behaviour
type: vision
triggers: [designing a new feature, choosing where data lives, deciding build-time vs runtime, adding media handling, working with tags]
related: [instance-types, config-layers, development-principles]
---

# Architecture Principles

## Static is Sacred

The public site is HTML files in `dist/`. Zip them, serve from anywhere. Admin pages are server-rendered, but if admin goes down, the public site keeps serving. Never make a public page depend on a running server.

## Develop on a Train

`git clone data && git clone app && npm run dev` — no internet needed. No database required. No network calls. If a feature would break offline development, find another way.

## Universal Media Pattern

A single key identifies every media asset. The app resolves it to URLs at render time. Components never touch vendor URLs directly.

Photos and videos are equal — all media entries live in one ordered list. Never filter by type, never treat photos and videos as separate collections. The `type` field exists for rendering (`img` vs `video` tag), not for partitioning logic.

## Data Locality

Data lives next to what uses it. Route photos live in the route's `media.yml`. Place photos live in the place's frontmatter. Never centralize data that belongs to a specific content item.

City-level files exist only for data with no content item to live next to. When building indexes over distributed data, the index is a **computed view** — never the canonical store.

## Data Insights

The build has simultaneous access to the entire dataset. It computes relationships and rankings that individual pages can't know alone — difficulty scoring, similarity matrix, route shape classification, nearby places.

All insights are build-time computation frozen into static HTML. Never compute dataset-wide intelligence at request time.

## Tags as Behaviour Triggers

Tags are lightweight feature flags. A single tag can recontextualize an entire entity — `bike-shop` on an organizer demotes it from the magazine, moves it to a separate section on the communities page, and turns sibling tags into shop specialties (`repairs`, `cargo`, `mobile`).

Tags combine: `bike-shop` + `mobile` means no physical locations. No enums, no feature flag infrastructure — just data that the UI responds to.

When designing new behaviour variations, prefer a tag over a new field or content type. A tag is data the community can edit; a schema field is structure only a developer can change.

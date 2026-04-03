---
description: Empathy, universality, show don't tell, domain-driven design, durability, docs currency
type: guide
triggers: [making product decisions, choosing defaults, naming domain concepts, writing for new users, adding content types]
related: [voice-and-feel, architecture-principles, brand-framing]
---

# Development Principles

## Empathy

The people using this range from experienced randonneurs to someone Googling "bike rides near me" for the first time. Every page, every label, every default should make sense to the least experienced person who might see it.

Never use absolute fitness language ("easy", "hard") — use relative framing ("shorter than most rides on this site").

## Universality

Three instance types, multiple languages, cities on every continent. Never assume a single locale, measurement system, or way of organising cycling. Build for the general case. Hardcode nothing.

## Show, Don't Tell

Real photos taken by real people on real rides. Real routes ridden by someone who was there. No stock imagery, no AI-generated content, no pitching. The product speaks through what it contains.

## Domain-Driven Design

The codebase models cycling reality: routes, rides, tours, events, places, waypoints, organisers. These aren't arbitrary labels — they're how cyclists already think.

When a new feature fits naturally into the domain model, it's probably right. When it needs workarounds, the model might need to grow. Name things what cyclists call them.

When the domain model is right, features follow naturally. When it's wrong, every feature is a workaround.

## Stand the Test of Time

A club's event archive spans decades. A blog's ride history is a personal record. Content must not depend on a specific host, a specific API, or this project's continued existence.

Data lives in Git as plain files — Markdown, YAML, GPX. No lock-in. No proprietary formats. The content outlives the platform.

## Keep Docs Current

When changing behaviour, update the relevant docs and AGENTS.md files in the same commit. Stale docs are worse than no docs.

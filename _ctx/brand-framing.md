---
description: whereto.bike umbrella, instance types, rider-first positioning, naming conventions
type: vision
triggers: [writing about the product, naming features, positioning copy, adding branding elements, onboarding text]
related: [voice-and-feel, instance-types]
---

# Brand & Product Framing

## Who This Is For

Someone who loves cycling wants to share it with someone they care about. They're looking for the right ride — somewhere worth going, not too far, good surface. Maybe there's a bakery at the turnaround point, or a lookout over the river, or a swimming spot for after. They need the information to be truthful, because this is how cycling clicks for a new person. Not through arguments or marketing, but through one good ride.

If the distance is off, if the surface info is missing, if nobody mentioned the hill or the cafe at kilometre twelve — that ride goes differently. And someone who could have discovered that a bicycle is freedom might not try again.

That's what this software carries. A route wiki helps a city's riders find and share the good roads. A personal blog lets someone show what cycling has given them. A club archive preserves the history of people who ride long distances together. Each mode, done well, puts more people on bicycles.

A bicycle for the mind already exists. This is the other half.

## Brand Hierarchy

- **whereto.bike** — Global cycling platform (umbrella brand, AGPL-licensed). The WordPress for cycling.
- **ottawabybike.ca** — Ottawa instance, established local brand (est. 2022), "powered by whereto.bike."
- **{city}.whereto.bike** — Future city subdomains.

## Instance Types

One codebase, three modes:

- **Wiki** — Community route database. The default.
- **Blog** — Personal ride journal.
- **Club** — Randonneuring/event archive.

Set via `instance_type` in city config. Conditionally enabled features, not separate codebases.

## Positioning

- **Rider first, contributor second.** Lead with utility (find a ride), not contribution (add a GPX).
- **Human over algorithmic.** Every photo was taken by someone who was there. Every route was ridden by a real person.
- **Don't name competitors.** Let the product speak for itself.

## Take the Path That Leads to More Cycling

When two approaches both work, choose the one that results in more people riding — feature prioritisation, copy tone, default settings, what gets prominent placement. A route page that highlights the waterfall at kilometre eight does more for cycling than one that leads with elevation gain.

Serve both sides of human psychology. Some people need reassurance — accurate distances, surface types, traffic info. Others need a reason to go — the destination, the scenery, the excuse to be outside. Safety information is the floor. Joy is the ceiling.

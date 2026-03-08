---
title: How it works
description: The technical architecture behind whereto.bike cycling guides.
---

whereto.bike guides are static websites — plain HTML files served from a CDN. Fast, reliable, works offline once loaded.

## Content lives in Git

All content — routes, photos, events, guides — lives in a Git repository as Markdown files, YAML, and GPX tracks. This means:

- **Full version history.** Every edit is tracked. Any change can be reverted.
- **No database dependency.** Clone the repo and you have all the content.
- **Portable.** Move to any hosting provider. No vendor lock-in.

## Community editing

Editors log in with passkeys (no passwords). Three roles:

- **Guests** can edit anonymously with a pseudonym
- **Editors** have full editing access
- **Admins** can moderate (revert edits, manage users)

All edits commit directly — no draft/review bottleneck. Admins moderate after the fact, like Wikipedia.

## Static site generation

The content repo is processed by [Astro](https://astro.build) at build time. The build computes data insights (difficulty scores, route similarity, elevation analysis) and freezes everything into static HTML. The public site needs no server, no database, no API calls.

Admin pages are server-rendered for editing, but if the admin goes down, the public site keeps serving.

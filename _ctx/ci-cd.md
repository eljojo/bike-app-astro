---
description: CI/CD workflows, deploy matrix, screenshot auto-update, build order
type: pattern
triggers: [modifying CI, adding workflows, debugging deploys, changing build order, working with screenshots]
related: [e2e-testing]
---

# CI/CD

Workflows live in `.github/workflows/`.

## Key Workflows

### `ci.yml` — Pull Request Pipeline

Runs on PRs to `main`. Lint, typecheck, unit tests, E2E tests, then builds and deploys Ottawa staging + demo + brevet production. Screenshot baselines auto-updated and committed.

### `production.yml` — Production Deploy

Runs on push to `main` or data repo webhook (`data-updated`). Matrix deploys Ottawa, demo, brevet. Smart city detection: data webhooks rebuild only the affected city. Also deploys video agent Lambda on code changes.

### `staging.yml` — Staging Deploy

Manual dispatch or data repo webhook (`staging-data-updated`). Builds Ottawa with `data-ref: staging`.

### `_build-city.yml` — Reusable Build Workflow

Called by all deploy workflows. Inputs: `city`, `wrangler-env`, `deploy`, `run-migrations`, `data-ref`, etc.

Handles: checkout, map generation, contributor stats, `astro build`, wrangler config patching, D1 migrations, Cloudflare deploy, stale cache cleanup.

### `_test.yml` — Reusable Test Workflow

Runs unit + all E2E suites (public, admin, blog, club). Auto-commits updated screenshot baselines on PRs.

## Staging Deploy Flow

PR to `main` → `ci.yml` → `deploy-ottawa-staging` job → calls `_build-city.yml` with `wrangler-env: staging`, `data-ref: staging`, `run-migrations: true`.

## Build-Time Env Vars

`_build-city.yml` resolves `VIDEO_PREFIX` from `wrangler.jsonc` env vars (via `sed` + `jq`) and passes it to `astro build`. If this resolution fails, the build silently uses `CITY` as fallback — video key annotation will break without error.

## Screenshot Auto-Update

`_test.yml` runs Playwright with `--update-snapshots`, commits diffs, and posts a PR comment listing affected snapshots. Only runs for PR authors with push access (blocks forks).

## Build Order

`make contributors` and `make maps` must run before `astro build` — they generate files consumed by virtual modules or served as static assets.

## Caching Strategy

- **LFS**: 2-week rolling cache
- **Map thumbnails**: keyed on GPX hashes
- **Astro content cache**: keyed on city content hash
- **Playwright browsers**: keyed on lockfile

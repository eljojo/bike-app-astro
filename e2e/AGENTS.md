# E2E Tests

## Test Dates Must Be 2099

Fixture dates must be far in the future to avoid time-dependent breakage (`isPastEvent()` logic).

## Never Delete the SQLite DB While Server Runs

The Astro preview server holds a persistent connection to `.data/local.db`. Use `seedSession()` for per-test state.

## Fixture System

- Isolated content directory: `.data/e2e-content/demo/`
- Git repo initialized in fixture (for `LocalGitService`)
- SQLite DB: `.data/local.db`, port 4323
- `.ready` sentinel prevents duplicate setup across Playwright workers
- Bypasses WebAuthn by seeding sessions directly
- Restores fixture files via `git show` (read-only, no index lock)

## Waiting for Preact Hydration

**Never use `waitForTimeout()`.** Use `waitForHydration(page)` from `e2e/admin/helpers.ts` — waits for `data-hydrated="true"`.

## Parallelization

Each writing spec owns its own fixture. Don't share mutable fixtures across specs.

## Screenshot Tests

- Build against `demo` fixture city (or `blog`/`demo-club` for instance-specific tests).
- Baselines tracked with Git LFS.
- **Never generate or update snapshots locally.** CI generates them via `--update-snapshots`.
- Screenshot specs should be separate from functional test specs.

## Detailed Context

- [E2E testing](../_ctx/e2e-testing.md)

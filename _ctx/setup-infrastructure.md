---
description: "How secrets and env vars are provisioned — secrets manifest, setup scripts, how to add env vars"
type: knowledge
triggers: [adding a new secret, adding env vars, setting up a new city, provisioning infrastructure]
related: [config-layers, vendor-isolation]
---

# Setup Infrastructure

## Secrets Manifest — Single Source of Truth

`scripts/lib/secrets-manifest.mjs` defines every secret and env var the app needs. Both wiki setup (`scripts/setup-city.js`) and blog setup (`packages/create-bike-blog/templates/scripts/setup.js`) import from it.

Each entry has:
- `name` — binding name (matches `AppEnv`)
- `required` — will the app crash without it?
- `kind` — `'secret'` (encrypted, wrangler secret) or `'var'` (plaintext, in wrangler.jsonc)
- `instanceTypes` — which instance types need it (`['wiki', 'blog', 'club']`)
- `autoDetect` — null or a detection strategy (e.g., `'cloudflare-account-id'`)
- `description` and `howTo` — human instructions

## Adding a New Secret

1. Add entry to `scripts/lib/secrets-manifest.mjs`
2. Add to `src/lib/config/app-env.ts` interface
3. Run `make setup-city` — it provisions the secret for all cities
4. If build-time only, add to `.github/workflows/_build-city.yml` secrets

## Setup Scripts

- **`scripts/setup-city.js`** — idempotent orchestrator for wiki/club instances. Creates wrangler environments, provisions secrets, configures R2 CORS, attaches custom domains.
- **`scripts/setup-aws-video.js`** — video pipeline (S3, Lambda, IAM). Exports `setWranglerSecret()` used by setup-city.
- **`packages/create-bike-blog/templates/scripts/setup.js`** — blog scaffolder setup.

Usage: `make setup-city`, `make setup-city ARGS="--city santiago"`, `make setup-city ARGS="--dry-run"`.

## Secret Flow

```
secrets-manifest.mjs
  → setup-city.js reads it
  → wrangler secret put (per environment)
  → Cloudflare Worker receives it at runtime
  → env.service.ts exposes it as AppEnv
```

Build-time secrets (e.g., `GOOGLE_MAPS_STATIC_API_KEY`) also flow through GitHub Actions secrets → CI workflow → `process.env`.

## Var vs Secret

- **Vars** — plaintext in `wrangler.jsonc` `vars` block. For non-sensitive config: `GIT_BRANCH`, `STORAGE_KEY_PREFIX`, `MEDIACONVERT_REGION`.
- **Secrets** — encrypted, stored separately in Cloudflare. For API keys, tokens, credentials.

Vars and secrets share the same namespace — `setWranglerSecret()` skips if the name is already defined as a var.

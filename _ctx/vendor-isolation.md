---
description: Every cloud service behind an adapter interface — one wrapper file per vendor concern
type: rule
triggers: [adding cloud integration, importing platform module, touching adapter files, adding external service]
related: [server-boundary]
---

# Vendor Isolation

Every cloud service is behind an adapter interface. Swap Cloudflare to Docker by changing one adapter. This is a non-negotiable architectural constraint.

## The rule

NEVER import platform-specific modules directly in application code:

- `cloudflare:workers` — banned outside adapter files
- AWS SDK (`@aws-sdk/*`) — banned outside adapter files
- Vercel helpers (`@vercel/*`) — banned outside adapter files
- Any provider-specific module — banned outside adapter files

All platform APIs must be accessed through a single wrapper file in `src/lib/`. One wrapper file per vendor concern. If the vendor renames or breaks their API, only one file changes.

## The 6 adapter boundary points

The local-vs-production switch (`RUNTIME=local`) is checked at six isolation boundaries:

| Boundary | Local | Production |
|----------|-------|------------|
| **Environment service** `src/lib/env/env.service.ts` | `env.adapter-local.ts` | `cloudflare:workers` |
| **Astro adapter** `src/lib/env/adapter.ts` | `@astrojs/node` | `@astrojs/cloudflare` |
| **Git operations** `src/lib/git/git-factory.ts` | `LocalGitService` (simple-git) | `GitService` (GitHub API) |
| **Database** `src/lib/get-db.ts` | Fresh `better-sqlite3` per call | `getD1Db(env.DB)` (D1) |
| **Media storage** `src/lib/media/storage.adapter-local.ts` | Filesystem (`.data/uploads/`) | R2 bucket |
| **Tile cache** `src/lib/tile-cache/tile-cache.ts` | Filesystem (`.data/tile-cache/`) | Workers KV |

## Adding a new vendor integration

1. **Create the adapter interface** — define the contract in a plain `.ts` file (no vendor imports).
2. **Implement local adapter** — uses filesystem, SQLite, or in-memory storage. Must work offline.
3. **Implement production adapter** — uses the cloud service. All vendor imports confined here.
4. **Create the factory** — checks `RUNTIME` and returns the appropriate adapter. This is the only file application code imports.
5. **One wrapper per concern** — don't combine unrelated vendor operations in one file.

## What application code does

```typescript
// Correct — imports the factory, gets the right adapter
import { getDb } from '@/lib/get-db';
import { getGitService } from '@/lib/git/git-factory';
import { getStorage } from '@/lib/media/storage';

// Wrong — imports vendor module directly
import { D1Database } from 'cloudflare:workers';
import { S3Client } from '@aws-sdk/client-s3';
```

## ESLint enforcement

No ESLint rule currently enforces vendor isolation at the import level — it's enforced by code review and the adapter file naming convention (`*.adapter-*.ts`). Adapter files are exempt from the server boundary ESLint rules.

## Why this matters

- **Offline development:** `git clone && npm run dev` must work without internet, without cloud credentials, without a running database server. Every adapter has a local implementation that fulfills this.
- **Portability:** The platform can move between cloud providers by swapping adapter files. Application logic never changes.
- **Testability:** Tests use the local adapters. No mocking of cloud APIs needed.

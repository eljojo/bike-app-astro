---
description: Model schemas as source of truth, content type registry, ContentOps, GitFiles
type: knowledge
triggers: [adding content types, modifying schemas, changing content pipeline, working with models]
related: [save-pipeline, adding-new-things, virtual-modules, bike-paths]
---

# Content Model

## Model Schemas Are Canonical

Model files in `src/lib/models/` are the single source of truth for shared domain schemas: variants, waypoints, registration, results, event series, media items, and status enums. Collection schemas in `src/schemas/index.ts` import from model files rather than defining their own copies.

When adding or changing a domain schema, update the model file first — the collection schema picks up the change through its import.

Status enums are defined as exported `as const` arrays in each model file (e.g., `ROUTE_STATUSES`, `EVENT_STATUSES`). Both model schemas and collection schemas reference these arrays.

## Shared Base Types

All content types share types from `src/lib/models/content-model.ts`:

- **`GitFileSnapshot`** — `{ content: string; sha: string }` — a file's content and blob SHA from git
- **`GitFiles`** — `{ primaryFile: GitFileSnapshot | null; auxiliaryFiles?: Record<string, GitFileSnapshot | null> }` — the set of git files for a content item
- **`baseMediaItemSchema`** — Zod schema for media items shared across all content types (key, type, caption, cover, dimensions, GPS coordinates, video fields)
- **`parseMediaItem()`** — extracts known fields from raw YAML-parsed objects

## Model File Pattern

Each content type has a pair of model files in `src/lib/models/`:

- **`{type}-model.ts`** (browser-safe) — types, Zod schemas, pure functions
- **`{type}-model.server.ts`** (server-only) — `fromGit()`, `fromCache()`, `buildFreshData()`, `computeContentHash()`

The `.server.ts` file uses Node APIs and is only imported by loaders, save handlers, and other server files.

## Content Type Registry

`src/lib/content/content-types.ts` defines `ContentTypeConfig` and `getContentTypes()` — returns active content types based on instance features. Each config defines admin routes, API endpoints, and UI metadata.

## ContentOps

`src/lib/content/content-ops.server.ts` provides shared operations per content type:

- `getFilePaths(slug)` — returns primary and auxiliary file paths for a content item
- `computeContentHash(files)` — computes a content hash from git files
- `buildFreshData(slug, files)` — builds the admin data object from git files

Used by the content type registry, save handlers, and the revert endpoint.

## Content Pipeline Flow

Content lives in a separate data repo (`~/code/bike-routes`), loaded via Astro content collections. `CONTENT_DIR` points to it, `CITY` selects which city. City config: `{CONTENT_DIR}/{CITY}/config.yml`.

Collections: `routes`, `places`, `guides`, `events`, `organizers`, `pages` — defined in `src/content.config.ts`. Translation files (`*.??.md`) excluded from base loading.

Routes use a custom loader (`src/loaders/routes.ts`) with directory-based structure, incremental caching, GPX parsing, and locale translations.

Rides (blog) live under `{CITY}/rides/` as GPX files with optional sidecar `.md` and `-media.yml`. Tour grouping from directory structure.

## Serialization Rule

All content data serialization/deserialization MUST go through model files. Never hand-roll `JSON.stringify`/`JSON.parse` for content types. File serialization uses `serializeMdFile()` and `serializeYamlFile()` from `src/lib/content/file-serializers.ts`.

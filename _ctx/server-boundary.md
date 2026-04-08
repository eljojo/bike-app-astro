---
description: .server.ts naming convention — what can import what, Node API restrictions
type: rule
triggers: [creating files in src/lib/, importing node: modules, splitting a file, creating a new library module]
related: [vendor-isolation]
---

# Server Boundary Convention

Files in `src/lib/` follow a `.server.ts` naming convention that enforces the browser/server split.

## The two categories

**Browser-safe** (`.ts` without `.server` in the name):
- Can be imported by Preact components (`.tsx` files)
- Can be imported by other browser-safe files
- MUST NOT use Node.js APIs: `node:path`, `node:fs`, `node:crypto`, `node:child_process`, etc.
- Contains: types, schemas, Zod validators, pure functions, constants

**Server-only** (`.server.ts`):
- Can use any Node.js API
- Can only be imported by: server views (`.astro` pages), loaders, build scripts, other `.server.ts` files
- MUST NOT be imported by `.tsx` files or browser-safe `.ts` files in `src/lib/`
- Contains: database queries, file I/O, git operations, anything requiring Node APIs

## ESLint enforcement

Two rules enforce this boundary:

- **`no-server-import-in-browser`** — blocks `.server` imports from `.tsx` files and shared `.ts` files in `src/lib/`
- **`no-restricted-imports`** — bans `node:*` imports in non-`.server` files within `src/lib/`

These run in `make lint`. CI enforces them.

## Exempt files

Not everything follows this convention:

- Adapter files (`*.adapter-*.ts`) — these exist at the vendor boundary
- `git/` directory — git operations are inherently server-side
- Build-time transform files (`city-config.ts`) — run only during build
- Map image URL builder (`map-image-url.ts`) — browser-safe, no Node APIs

## Splitting a mixed file

When a file needs both browser-safe exports and server-only logic:

1. **Types, schemas, and pure functions** stay in the `.ts` file
2. **Functions using Node APIs** move to a `.server.ts` companion with the same base name
3. The `.server.ts` file imports from the `.ts` file (not the reverse)

See `src/lib/models/` for examples of this pattern. Model files (`.ts`) define types and schemas. Companion `.server.ts` files implement `fromGit()`, `buildFreshData()`, and other server-only operations.

## Common mistakes

- Importing `node:path` in a schema file — move path logic to a `.server.ts` companion
- Importing a `.server.ts` file from a Preact component — restructure to pass data as props instead
- Creating a new utility in `src/lib/` without deciding which side of the boundary it belongs on — decide first, name accordingly

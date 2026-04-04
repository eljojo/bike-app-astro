---
description: SaveHandlers factory, conflict detection, D1 cache overlay, afterCommit hooks
type: pattern
triggers: [editing save handlers, adding content types, debugging save conflicts, modifying admin save flow, working with D1 cache]
related: [content-model, adding-new-things, preact-islands]
---

# Save Pipeline

Editor → `POST /api/{content-type}/{slug}` → `content-save.ts` orchestrator → `SaveHandlers<T>` → git commit → D1 cache update.

## SaveHandlers Factory Pattern

All save handlers use a factory function (e.g., `createRouteHandlers()`, `createEventHandlers()`) that returns a fresh `SaveHandlers` object per request. Request-scoped state (shared keys data, organizer updates, etc.) is encapsulated as local variables inside the factory closure. This prevents concurrent request cross-contamination on Cloudflare Workers, where module-level variables persist across requests in the same isolate.

```typescript
export function createRouteHandlers(...): SaveHandlers<RouteUpdate, RouteBuildResult> { ... }
export const POST = createApiHandler(/* ... */, () => createRouteHandlers(sharedKeysData));
```

Never store request-scoped data in module-level `let` variables in save handler files.

## SaveHandlers Interface

`SaveHandlers<T, R>` in `src/lib/content/content-save.ts` defines ~10 methods. Optional extension interfaces:

- `WithSlugValidation` — validate new slugs before commit
- `WithExistenceCheck` — check if content already exists (for create flows)
- `WithAfterCommit` — post-commit side effects (media registry updates)

Implementations live in `src/views/api/{type}-save.ts`.

## Frontmatter Merge Rule

Always read existing frontmatter first, spread editor fields on top. Never reconstruct from only UI fields — this silently deletes fields the editor doesn't manage (`variants`, `created_at`, `strava_url`, etc.). Use `mergeFrontmatter()` from `src/lib/content/save-helpers.server.ts`.

## Conflict Detection

Two mechanisms, in priority order:

1. **D1 `githubSha` vs current git file SHA** (primary) — compare-and-swap via blob SHAs from the GitHub API
2. **Content hash from the editor** (fallback when no D1 cache exists)

On conflict, the cache is refreshed before returning 409.

**Content hash is blob SHA, not commit SHA.** The D1 cache stores blob SHAs from the GitHub API. Using commit SHAs causes false 409 conflicts on consecutive saves.

**Return new contentHash after save.** The client MUST update its local state with the returned hash. Forgetting this breaks consecutive saves. The `useEditorState` hook handles this — make sure `onSuccess` doesn't discard the returned hash.

## Permission Stripping

Enforced at the pipeline level in `saveContent()`, not per-handler:

- Non-admin users have `status` stripped from frontmatter updates
- Non-editors have `newSlug` stripped

## afterCommit Pattern

All save handlers update the media-shared-keys registry via `updateMediaRegistryCache()`. Track old vs new media keys and build a changes array. Failures are logged but don't fail the response — media registry updates are non-critical.

## D1 Cache Overlay

Admin pages use two-tier data loading (`src/lib/content/load-admin-content.server.ts`):

1. **D1 `content_edits` table** — updated after every save via `upsertContentCache()`
2. **Virtual module data** — build-time snapshots, fallback when no cache entry exists

List overlays merge build-time data with D1 cache — cached entries overlay matching items, and cache-only items (created since last deploy) are appended at the end.

`fromCache` parser uses Zod schema validation — if cached JSON doesn't validate, it silently falls back to virtual module data. Adding a new field to a model requires updating both the schema and the cache parser in the model file.

Deploy cleanup: `WHERE updated_at < $BUILD_START` deletes stale cache entries without losing concurrent edits.

## Key Files

| File | Role |
|------|------|
| `src/lib/content/content-save.ts` | Core orchestrator: `saveContent()`, `SaveHandlers<T, R>`, `readCurrentState()` |
| `src/lib/content/cache.ts` | `upsertContentCache()` — D1 insert-on-conflict-update |
| `src/lib/content/load-admin-content.server.ts` | Two-tier loading, list overlays |
| `src/lib/content/save-helpers.server.ts` | `mergeFrontmatter()`, `buildCommitTrailer()`, media key diff utilities |
| `src/lib/content/file-serializers.ts` | `serializeMdFile()`, `serializeYamlFile()` |
| `src/views/api/{type}-save.ts` | Per-content-type `SaveHandlers` implementations |

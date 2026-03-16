# Content (`src/lib/content/`)

Content save pipeline, D1 cache overlay, admin content loading, and file serialization. This domain orchestrates the flow from editor submission through git commit to cache update.

## Files

| File | Role |
|------|------|
| `content-save.ts` | Core save orchestrator: `saveContent()` generic function, `SaveHandlers<T, R>` interface (10 methods), `readCurrentState()`. Handles auth, conflict detection (compare-and-swap via blob SHAs), git commit, D1 cache update, `afterCommit` hooks |
| `cache.ts` | `upsertContentCache()` — centralizes the D1 insert-on-conflict-update pattern for the `content_edits` table |
| `load-admin-content.ts` | Two-tier data loading: D1 cache then virtual module fallback. `loadAdminContent()` (generic), `loadDetailPageData()` (convenience wrapper), list overlays: `loadAdminRouteList()`, `loadAdminEventList()`, `loadAdminRideList()`, `loadSharedKeysMap()`, `loadParkedPhotosWithOverlay()` |
| `content-filters.ts` | `isPublished()` — filters content items by `status === 'published'` |
| `content-types.ts` | `ContentTypeConfig` registry, `getContentTypes()` — returns active content types based on instance features. Defines admin routes and API endpoints per content type |
| `file-serializers.ts` | `serializeMdFile()` (frontmatter + body to markdown), `serializeYamlFile()` (data to YAML). Used by save handlers to build file content for git commits |
| `save-helpers.ts` | Shared save handler utilities: `mergeFrontmatter()` (overlays updates on existing frontmatter), `buildCommitTrailer()`, `buildPhotoKeyChanges()`, `computeMediaKeyDiff()`, `buildMediaKeyChanges()`, `loadExistingMedia()` |

## Gotchas

- **`SaveHandlers<T, R>` has optional interfaces**: `WithSlugValidation`, `WithExistenceCheck`, `WithAfterCommit`. Implementations in `src/views/api/{type}-save.ts` use these for type-specific behavior.
- **Conflict detection uses two mechanisms**: (1) D1 `githubSha` vs current git file SHA (primary), (2) content hash from the editor (fallback when no D1 cache exists). On conflict, the cache is refreshed before returning 409.
- **Permission stripping happens in `saveContent()`** — non-admin users have `status` stripped from frontmatter; non-editors have `newSlug` stripped. This is enforced at the pipeline level, not per-handler.
- **`afterCommit` failures are logged but don't fail the response** — they update the photo registry and are non-critical.
- **List overlays merge build-time data with D1 cache** — cached entries overlay matching items, and cache-only items (created since last deploy) are appended at the end.
- **`fromCache` parser uses Zod schema validation** — if cached JSON doesn't validate, it silently falls back to virtual module data. Adding a new field to a model requires updating both the schema and the cache parser in the model file.
- **Deploy cleanup**: `WHERE updated_at < $BUILD_START` deletes stale cache entries without losing concurrent edits.

## Cross-References

- `src/views/api/route-save.ts`, `ride-save.ts`, `event-save.ts`, `place-save.ts` — implement `SaveHandlers` per content type
- `src/lib/models/` — `fromCache()` functions that parse D1 cache entries
- `git/` — `content-save.ts` creates git services via the factory
- `content-ops.ts` — shared `ContentOps` for file paths, hashing, and cache building (in this directory)

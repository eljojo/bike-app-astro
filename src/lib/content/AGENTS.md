# Content (`src/lib/content/`)

Content save pipeline, D1 cache overlay, admin content loading, and file serialization.

## Files

| File | Role |
|------|------|
| `content-save.ts` | Core save orchestrator: `saveContent()`, `SaveHandlers<T, R>` interface, `readCurrentState()` |
| `cache.ts` | `upsertContentCache()` — D1 insert-on-conflict-update for `content_edits` table |
| `load-admin-content.server.ts` | Two-tier loading: D1 cache then virtual module fallback. List overlays per content type |
| `content-filters.ts` | `isPublished()` — filters by `status === 'published'` |
| `content-types.ts` | `ContentTypeConfig` registry, `getContentTypes()` — active types based on instance features |
| `file-serializers.ts` | `serializeMdFile()`, `serializeYamlFile()` — build file content for git commits |
| `save-helpers.server.ts` | `mergeFrontmatter()`, `buildCommitTrailer()`, media key diff utilities |

## Gotchas

- **Conflict detection uses two mechanisms**: D1 `githubSha` vs git file SHA (primary), content hash (fallback). On conflict, cache is refreshed before 409.
- **Permission stripping in `saveContent()`** — non-admins lose `status`; non-editors lose `newSlug`.
- **`fromCache` parser uses Zod validation** — invalid cached JSON silently falls back to virtual module data. New model fields need both schema and cache parser updates.

## Detailed Context

- [Save pipeline](../../../_ctx/save-pipeline.md)

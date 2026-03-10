# API Endpoints

All files here MUST have `export const prerender = false`.

## Save Pipeline Rules

- **Always merge frontmatter**: read existing frontmatter first, spread editor fields on top. Never reconstruct from only UI fields — this silently deletes fields the editor doesn't manage (variants, created_at, strava_url, etc.).
- **Content hash is blob SHA, not commit SHA**: The D1 cache stores blob SHAs from the GitHub API. Using commit SHAs causes false 409 conflicts on consecutive saves.
- **Return new contentHash after save**: The client MUST update its local state with the returned hash. Forgetting this breaks consecutive saves.
- **Permission stripping**: non-admin users have `status` stripped from updates; non-editors have `newSlug` stripped.

## afterCommit Pattern

All save handlers update the photo-shared-keys registry via `updatePhotoRegistryCache()`. Failures are logged but don't fail the response. Track old vs new photo/media keys and build a changes array.

## Registering New Endpoints

1. Create file here (NOT in `src/pages/api/` — exception: auth endpoints in `src/pages/api/auth/`)
2. Add `export const prerender = false` at top level
3. Register in `src/integrations/admin-routes.ts` — static routes MUST precede parameterized routes when they share a prefix
4. If public (no auth needed), add exclusion in `src/middleware.ts` `isProtected` check
5. If new permission needed, add action to `src/lib/authorize.ts`

## Zod Imports

Import from `astro/zod`, not `zod` or `astro:content`. This project uses Zod v4 via Astro. Key v4 differences: `z.record(z.string(), z.unknown())` (not single-arg), `z.looseObject()` (not `.passthrough()`).

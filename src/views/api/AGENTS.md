# API Endpoints

All files here MUST have `export const prerender = false`.

## Save Pipeline Rules

- **Always merge frontmatter**: read existing frontmatter first, spread editor fields on top. Never reconstruct from only UI fields — this silently deletes fields the editor doesn't manage (variants, created_at, strava_url, etc.).
- **Content hash is blob SHA, not commit SHA**: The D1 cache stores blob SHAs from the GitHub API. Using commit SHAs causes false 409 conflicts on consecutive saves.
- **Return new contentHash after save**: The client MUST update its local state with the returned hash. Forgetting this breaks consecutive saves.
- **Permission stripping**: non-admin users have `status` stripped from updates; non-editors have `newSlug` stripped.

## Factory Pattern for Save Handlers

All save handlers use a factory function (e.g., `createRouteHandlers()`, `createEventHandlers()`) that returns a fresh `SaveHandlers` object per request. Request-scoped state (shared keys data, organizer updates, etc.) is encapsulated as local variables inside the factory closure. This prevents concurrent request cross-contamination on Cloudflare Workers, where module-level variables persist across requests in the same isolate.

The `POST` export calls the factory to get fresh handlers each time:
```typescript
export function createRouteHandlers(...): SaveHandlers<RouteUpdate, RouteBuildResult> { ... }
export const POST = createApiHandler(/* ... */, () => createRouteHandlers(sharedKeysData));
```

Never store request-scoped data in module-level `let` variables in save handler files.

## afterCommit Pattern

All save handlers update the media-shared-keys registry via `updateMediaRegistryCache()`. Failures are logged but don't fail the response. Track old vs new media keys and build a changes array.

## Registering New Endpoints

1. Create file here (auth endpoints go in `src/views/api/auth/`)
2. Add `export const prerender = false` at top level
3. Register in `src/integrations/admin-routes.ts` — static routes MUST precede parameterized routes when they share a prefix
4. If public (no auth needed), add exclusion in `src/middleware.ts` `isProtected` check
5. If new permission needed, add action to `src/lib/authorize.ts`

## Zod Imports

Import from `zod/v4`, not `zod` or `astro/zod`. Key v4 differences: `z.record(z.string(), z.unknown())` (not single-arg), `z.looseObject()` (not `.passthrough()`).

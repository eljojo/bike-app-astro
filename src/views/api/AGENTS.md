# API Endpoints

All files here MUST have `export const prerender = false` and call `authorize()` on every endpoint.

## Local Rules

- **Always merge frontmatter**: read existing first, spread editor fields on top. Never reconstruct from only UI fields.
- **Content hash is blob SHA, not commit SHA**: commit SHAs cause false 409 conflicts.
- **Return new contentHash after save**: client must update local state.
- **Zod v4**: import from `zod/v4`, not `zod` or `astro/zod`.

## Factory Pattern

All save handlers use a factory function returning a fresh `SaveHandlers` per request. Request-scoped state lives in the factory closure, not module-level variables. This prevents cross-contamination on Cloudflare Workers (isolate reuse).

```typescript
export const POST = createApiHandler(/* ... */, () => createRouteHandlers(sharedKeysData));
```

## Registering New Endpoints

1. Create file here (auth endpoints in `src/views/api/auth/`)
2. Add `export const prerender = false`
3. Register in `src/integrations/admin-routes.ts` — static routes before parameterized
4. If public, add exclusion in `src/middleware.ts`
5. If new permission, add action to `src/lib/auth/authorize.ts`

## Detailed Context

- [Save pipeline](../../../_ctx/save-pipeline.md)
- [Adding new things](../../../_ctx/adding-new-things.md)

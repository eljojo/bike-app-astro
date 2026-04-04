---
description: Cloudflare fetch() deadlock, Rollup dead-code elimination, Preact hydration timing, CSP updates, GitHub API
type: gotcha
triggers: [calling fetch on workers, debugging dead code, preact hydration issues, adding external resources, using github api, debugging build output]
related: [preact-islands, astro-cloudflare]
---

# Platform Integration Gotchas

AI is confidently wrong about platform behavior. These areas require extra verification — never trust that code works until you see it run in the target environment.

## Cloudflare Workers fetch() Deadlock

`fetch()` to your own Worker's origin deadlocks. The Worker is already handling the request — it can't call itself.

- Use `env.ASSETS.fetch()` for static files
- Use `readFileSync` for Node.js compatibility mode
- See `load-admin-content.server.ts` for the pattern

## Rollup Dead-Code Elimination

Never combine Vite `define` constants with `import.meta.env.*` in the same condition. Rollup evaluates them at different times and will eliminate branches you need.

`define` constants are replaced at parse time (before tree-shaking). `import.meta.env.*` values are resolved later. A condition that mixes both can have one branch eliminated before the other value is even known.

See `detailed_plan.md` Build-Time Constants section for the full explanation.

## Preact Hydration Timing

Islands don't hydrate synchronously. Code that assumes the island is ready immediately after page load will fail.

- Always use `useHydrated()` hook from `src/lib/hooks.ts`
- E2E tests must use `waitForHydration()` from E2E helpers
- Never use `waitForTimeout()` — it's flaky and slow

## CSP Updates

When adding any external resource (CDN, API, embed), update `src/lib/csp.ts`:

- New image origins → `img-src`
- New API endpoints → `connect-src`
- New embeds → `frame-src`

For SSR pages, use `is:inline nonce={cspNonce}`. For static pages (prerender=true), use bare `<script>` tags — Astro hashes them. Never use `is:inline` on static pages.

Upload origins (R2, S3) for `connect-src` are read at request time by `csp-env.ts`, NOT by `env.ts`. This is because `env.ts` has top-level await that silently kills Astro's prerender step when imported from middleware.

## GitHub API

When making GitHub API calls:

- Always include `User-Agent` header (GitHub rejects requests without it)
- Always handle rate limiting (check `X-RateLimit-Remaining`)
- Always parse error response bodies for diagnostics (don't just check status codes)

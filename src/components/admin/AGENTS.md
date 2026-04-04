# Admin Preact Islands

## Scoped CSS Does Not Work Here

Astro's scoped `<style>` blocks do NOT reach Preact islands. Create an underscore-prefixed SCSS partial in `src/styles/` and `@use` it from `admin.scss`.

## Textarea Hydration Bug

Preact has a known hydration issue with `<textarea>` — `hydrate()` skips the `value` prop, leaving it empty. Every textarea needs a `useEffect` ref workaround:

```tsx
const bodyRef = useRef<HTMLTextAreaElement>(null);
useEffect(() => {
  if (bodyRef.current && body && !bodyRef.current.value) {
    bodyRef.current.value = body;
  }
}, []);
```

## Content Hash State Sync

After save, the component MUST update its local `contentHash` from the server response. Using the initial hash causes false 409 conflicts. The `useEditorState` hook handles this.

## Hydration Signaling

Every island MUST use `useHydrated()` from `src/lib/hooks.ts`. This sets `data-hydrated="true"` for E2E tests. Never use `waitForTimeout()` — use `waitForHydration(page)`.

## Editor Pattern

All editors use `useEditorState()` from `./useEditorState.ts`: `saving`, `saved`, `error`, `githubUrl`, `save`, `setError`. The `validate` callback runs before save; `buildPayload` constructs the POST body.

## Detailed Context

- [Preact islands](../../../_ctx/preact-islands.md)
- [CSS styling](../../../_ctx/css-styling.md)

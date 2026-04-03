---
description: Textarea hydration bug, scoped CSS pitfall, useHydrated requirement, content hash sync, editor pattern
type: gotcha
triggers: [creating preact islands, debugging hydration, textarea empty after load, styling admin components, editor state management]
related: [css-styling, e2e-testing, save-pipeline]
---

# Preact Islands

## Scoped CSS Does Not Reach Islands

Astro's scoped `<style>` blocks do NOT reach Preact islands — they hydrate independently in their own DOM tree. Create an underscore-prefixed SCSS partial in `src/styles/` (e.g., `_community-editor.scss`) and `@use` it from `admin.scss`. See `css-styling.md` for the full colocation pattern.

## Textarea Hydration Bug

Preact has a known hydration issue with `<textarea>`. SSR renders text inside the element, but `hydrate()` skips the `value` prop, then child diffing removes the content — leaving the field empty.

Every textarea needs a ref-based workaround:

```tsx
const bodyRef = useRef<HTMLTextAreaElement>(null);
useEffect(() => {
  if (bodyRef.current && body && !bodyRef.current.value) {
    bodyRef.current.value = body;
  }
}, []);
```

## Content Hash State Sync

After a successful save, the component MUST update its local `contentHash` from the server response. Using the initial hash for subsequent saves causes false 409 conflicts.

The `useEditorState` hook handles this — make sure `onSuccess` doesn't discard the returned hash.

## Hydration Signaling (useHydrated)

Every admin Preact island MUST use the `useHydrated()` hook from `src/lib/hooks.ts`. This sets `data-hydrated="true"` on the root element after mount, which E2E tests use to wait for hydration.

```tsx
import { useHydrated } from '../../lib/hooks';

export default function MyEditor(props) {
  const hydratedRef = useHydrated<HTMLDivElement>();
  return <div ref={hydratedRef}>...</div>;
}
```

Never use `waitForTimeout()` in E2E tests. Use `waitForHydration(page)` instead.

## Editor State Pattern

All editors use `useEditorState()` from `./useEditorState.ts` which provides:

- `saving`, `saved`, `error` — UI state
- `githubUrl` — link to the committed file
- `save` — triggers the save flow
- `setError` — manual error setting

The `validate` callback runs before save. `buildPayload` constructs the POST body. `onSuccess` receives the server response for redirect/state-update logic (including content hash updates).

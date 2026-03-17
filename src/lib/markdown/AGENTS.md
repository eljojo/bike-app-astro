# Markdown (`src/lib/markdown/`)

Markdown rendering and preview text extraction. Used by the admin editor for live preview and by the content pipeline for rendering route/event descriptions.

## Files

| File | Role |
|------|------|
| `markdown-render.ts` | `renderMarkdownHtml()` — renders markdown to HTML via `marked`, then sanitizes: strips blocked tags (script, iframe, etc.), removes inline event handlers, strips `style` attributes, removes `javascript:` URLs |
| `markdown-preview.ts` | `makePreview()` — strips markdown formatting and returns the first two non-empty lines as preview text for list views |

## Gotchas

- **Sanitization is defense-in-depth.** CSP also blocks inline scripts, but the HTML sanitizer runs independently. Both layers must be maintained.
- The sanitizer strips `style` attributes to align with stricter CSP. If you need inline styles, add them via CSS classes instead.
- `marked.parse()` returns a promise in newer versions — the code wraps it with `Promise.resolve()` for compatibility.

## Cross-References

- Admin editor: renders markdown body preview via API endpoint
- Content loaders: `src/loaders/routes.ts` renders markdown at build time (uses its own marked instance, not this file)

# Markdown (`src/lib/markdown/`)

Markdown rendering and preview text extraction.

## Files

| File | Role |
|------|------|
| `markdown-render.ts` | `renderMarkdownHtml()` — renders via `marked`, then sanitizes (strips scripts, event handlers, style attributes) |
| `markdown-preview.ts` | `makePreview()` — strips formatting, returns first two non-empty lines |

## Gotchas

- **Sanitization is defense-in-depth.** CSP also blocks inline scripts, but the sanitizer runs independently.
- **`marked.parse()` returns a promise** — wrapped with `Promise.resolve()` for compatibility.

## Detailed Context

- [Content model](../../../_ctx/content-model.md)

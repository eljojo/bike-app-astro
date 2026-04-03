---
description: Admin UI style — utilitarian minimalism (Linear/Notion), no decoration, function over form
type: guide
triggers: [designing admin UI, adding admin pages, styling admin components, editor layout decisions]
related: [css-styling, preact-islands]
---

# Admin Design Language

## Style

Utilitarian minimalism. Think Linear or Notion — clean, functional, no decoration. The admin is a tool for contributors, not a marketing surface.

- **No unnecessary borders or shadows.** Use whitespace and typography for hierarchy.
- **Dense but scannable.** Information-rich without feeling cluttered.
- **Monochrome with accent.** The admin palette is neutral grays with the brand color for primary actions only.
- **Function over form.** Every pixel should earn its place. If a UI element doesn't help the user complete their task, remove it.

## Editor Layout

Editors use the `useEditorForm` + `EditorLayout` pattern. Two tabs: Edit and Preview. The save button is always visible. Conflict detection is inline (not a modal).

## Error States

Error messages should be human and helpful. No HTTP status codes, no "GitHub", no developer jargon. Say what happened and what the user can do about it.

## Design Reference

Mockups live at `~/code/bike-app/docs/plans/mockups/`.

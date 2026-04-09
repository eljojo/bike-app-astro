---
description: Admin UI design — inevitability with personality, Keynote not Numbers, content is the material
type: vision
triggers: [designing admin UI, adding admin pages, styling admin components, editor layout decisions]
related: [css-styling, preact-islands, voice-and-feel]
---

# Admin Design Language

## Philosophy

The admin interface should feel inevitable — like it couldn't have been designed any other way. Not minimal as a style choice, but reduced to essence as a consequence of caring deeply about what the contributor is trying to do.

But inevitable doesn't mean austere. This is Keynote, not Numbers. Both are clean. One has presence. The admin should feel like a place contributors enjoy being — a place with a point of view, not a gray tool that processes inputs.

The content is the material. A route description, a photo, an event date — these are what the contributor came to work with. The interface defers to them completely. When the UI disappears and the contributor is just working with their content, the design is succeeding. But the moments where the interface IS visible — a save confirmation, an empty state, a first-visit welcome — those moments should have warmth and personality.

## Principles

- **Inevitability with personality.** Every element feels necessary, but the overall experience has a point of view. A well-placed color, a considered transition, a message that sounds like a person — these aren't decoration, they're confidence.

- **The content is the hero.** Chrome exists to serve the content, not to frame it. An editor page should feel like you're editing a route, not like you're using an editor.

- **Quiet confidence, not quiet resignation.** The interface doesn't need to announce itself — but it shouldn't be afraid to have character. There's a difference between an interface that recedes because it's thoughtful and one that recedes because nobody made a decision.

- **Dense but calm.** Information-rich without feeling cluttered. Density and clarity aren't in tension — they're in balance when the hierarchy is right.

- **Moments of warmth.** Empty states, onboarding, success confirmations, error recovery — these are where personality lives. A first-time contributor should feel welcomed, not processed. "No routes yet" is a spreadsheet talking. "Upload a route you love" is a person talking.

- **Care is visible.** When a contributor opens the editor, they should sense that someone thought about their experience. The right field is where you expect it. The save button is where your eye goes. The error message tells you what to do, not what went wrong internally.

## Color and Vibrancy

- **Not monochrome.** The admin has a palette, not just grays. Color is used with intention — brand color for primary actions, but also considered accent colors that make the interface feel alive.
- **Color as meaning.** Status, feedback, and navigation use color to communicate, not just to decorate. A deploy progress bar, a "saved" confirmation, a tag category — color makes these legible at a glance.
- **Dark mode is a first-class experience.** Not an afterthought inversion. Dark mode should feel as considered as light mode — warm darks, not cold ones.

## Practical Rules

- **Typography for hierarchy.** Size, weight, and spacing do the work that borders and backgrounds usually do.
- **No unnecessary borders or shadows.** If you need a visual separator, question whether the layout itself could create the separation.
- **Consistent spacing.** Use design tokens from `_variables.scss`. Irregular spacing signals carelessness even when nobody can articulate why.
- **Transitions should be quick and purposeful.** Not decorative animation — just enough to show the user what changed and where to look.

## Editor Layout

Editors use `useEditorForm` + `EditorLayout`. Two tabs: Edit and Preview. The save button is always visible. Conflict detection is inline, not a modal — modals interrupt the flow and assert the application's needs over the contributor's.

## Error States

Error messages are human and helpful. No HTTP status codes, no "GitHub", no developer jargon. Say what happened and what the contributor can do about it. An error message is a moment where the interface is most visible — make it feel like someone cares, not like a system is reporting a fault.

## The Vibe

Think of the best moment in a Keynote presentation — the slide where the product appears and the room gets it instantly. No explanation needed. The design communicated the idea. That's what a well-designed admin page should feel like: you open it, you get it, you start working.

## Design Reference

Mockups live at `~/code/bike-app/docs/plans/mockups/`.

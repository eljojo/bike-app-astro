---
description: SCSS variables, dark mode pattern, colocated styles, admin.scss for islands
type: knowledge
triggers: [adding styles, modifying CSS, working with dark mode, styling preact islands, adding colors or breakpoints]
related: [preact-islands]
---

# CSS & Styling

## Design Tokens

Use SCSS variables from `src/styles/_variables.scss` — never hardcode colors or breakpoints.

Key variables: `$color-card-bg`, `$color-tag-bg`, `$color-btn-*`, `$border-radius`, `$breakpoint-*`, `$font-*`.

Shared mixins live in `src/styles/_mixins.scss`.

## Dark Mode

Every color change MUST have both light and dark variants using the `dark-mode` mixin from `_mixins.scss`. This is a recurring bug source (white text on white backgrounds, invisible icons in dark mode). Never add a color rule without its dark mode counterpart.

## SCSS Modern Compiler

The project uses `api: 'modern-compiler'`. Don't use deprecated Sass functions (`darken()`, `lighten()`, `adjust-hue()`, etc.). Use `color.scale()` or `color.adjust()` from `sass:color` if needed.

## Style Colocation

Styles live close to their components. Only reusable or truly global styles belong in shared files.

### Astro Components

Create a `.scss` file next to the component (e.g., `MagazineHome.scss` next to `MagazineHome.astro`) and import it in the frontmatter:

```astro
---
import './MagazineHome.scss';
---
```

Use `@use '../styles/variables' as *` and `@use '../styles/mixins' as *` at the top of the SCSS file.

### Preact Islands

Astro's scoped `<style>` blocks do NOT reach Preact islands (they hydrate independently). Create an underscore-prefixed SCSS partial in `src/styles/` (e.g., `_community-editor.scss`) and `@use` it from `admin.scss`. This keeps styles colocated conceptually while ensuring they reach the island.

### Shared Files

- **`global.scss`** — styles shared across many public pages (nav, footer, layout, `.admin-only` visibility toggle). Not for component-specific styles.
- **`admin.scss`** — shared admin styles (auth, editor layout, modals). Component-specific admin styles go in partials `@use`'d from admin.scss.
- **`_variables.scss` / `_mixins.scss`** — design tokens and shared mixins.

## Admin Visibility Toggle

Admin-only links on static pages (`.admin-edit-link`, `.nav-admin`) are hidden by default via CSS and revealed by adding the `admin-visible` class to `<body>`. This class is toggled by JavaScript reading the `logged_in` cookie (a non-httpOnly cookie set alongside the httpOnly `session_token`).

This avoids server-rendering conditional logic on prerendered static pages. Never replace this with server-side conditional rendering — it would break static page caching.

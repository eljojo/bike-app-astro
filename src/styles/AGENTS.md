# Styles

## Dark Mode — Every Color Needs Both Variants

Every color change MUST have both light and dark variants using the `dark-mode` mixin from `_mixins.scss`. This is a recurring bug source. Never add a color rule without its dark mode counterpart.

## SCSS Modern Compiler

Don't use deprecated Sass functions (`darken()`, `lighten()`, etc.). Use `color.scale()` or `color.adjust()` from `sass:color`.

## Style Colocation

- **Astro components**: `.scss` file next to the component, imported in frontmatter.
- **Preact islands**: underscore-prefixed partial in `src/styles/`, `@use`'d from `admin.scss`.
- **`global.scss`**: only truly shared public styles (nav, footer, layout).
- **`admin.scss`**: only shared admin styles. Component-specific go in partials.
- **`_variables.scss`**: design token source of truth. Never hardcode colors or breakpoints.

## Admin Visibility Toggle

`.admin-edit-link` and `.nav-admin` are hidden by CSS, revealed by `admin-visible` class on `<body>` via the `logged_in` cookie. Never replace with server-side rendering — breaks static caching.

## Detailed Context

- [CSS styling](../../_ctx/css-styling.md)

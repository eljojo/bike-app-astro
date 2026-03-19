# Styles

## Dark Mode — Every Color Needs Both Variants

Every color change MUST have both light and dark variants using the `dark-mode` mixin from `_mixins.scss`. This is a recurring bug source (white text on white backgrounds, invisible icons in dark mode). Never add a color rule without its dark mode counterpart.

## SCSS Modern Compiler

Don't use deprecated Sass functions (`darken()`, `lighten()`, `adjust-hue()`, etc.). The project uses `api: 'modern-compiler'`. Use `color.scale()` or `color.adjust()` from `sass:color` if needed.

## Style Colocation

Styles live close to their components. Only reusable or truly global styles belong in shared files.

- **Astro components**: Create a `.scss` file next to the component (e.g., `MagazineHome.scss` next to `MagazineHome.astro`) and import it in the frontmatter with `import './MagazineHome.scss'`. Use `@use '../styles/variables' as *` and `@use '../styles/mixins' as *` at the top.
- **Preact islands**: Scoped CSS does NOT reach Preact islands. Create an underscore-prefixed partial in `src/styles/` (e.g., `_community-editor.scss`) and `@use` it from `admin.scss`. This keeps the styles colocated conceptually while ensuring they reach the island.
- **`global.scss`**: Only for styles shared across many public pages (nav, footer, layout, `.admin-only` visibility toggle). Not for component-specific styles.
- **`admin.scss`**: Only for shared admin styles (auth, editor layout, modals). Component-specific admin styles go in partials `@use`'d from admin.scss.
- **`_variables.scss` / `_mixins.scss`**: Design tokens and shared mixins.

Use SCSS variables from `_variables.scss` — never hardcode colors or breakpoints. Key variables: `$color-card-bg`, `$color-tag-bg`, `$color-btn-*`, `$border-radius`, `$breakpoint-*`, `$font-*`.

## Admin Visibility Toggle — `logged_in` Cookie Pattern

Admin-only links on static pages (`.admin-edit-link`, `.nav-admin`) are hidden by default via CSS and revealed by adding the `admin-visible` class to `<body>`. This class is toggled by JavaScript reading the `logged_in` cookie (a non-httpOnly cookie set alongside the httpOnly `session_token`). This avoids server-rendering conditional logic on prerendered static pages. Never replace this with server-side conditional rendering — it would break static page caching.

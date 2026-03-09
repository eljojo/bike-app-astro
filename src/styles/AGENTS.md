# Styles

## Dark Mode — Every Color Needs Both Variants

Every color change MUST have both light and dark variants using the `dark-mode` mixin from `_mixins.scss`. This is a recurring bug source (white text on white backgrounds, invisible icons in dark mode). Never add a color rule without its dark mode counterpart.

## SCSS Modern Compiler

Don't use deprecated Sass functions (`darken()`, `lighten()`, `adjust-hue()`, etc.). The project uses `api: 'modern-compiler'`. Use `color.scale()` or `color.adjust()` from `sass:color` if needed.

## Three Style Layers

- `global.scss` — public page styles, imported via `Base.astro`
- `admin.scss` — ALL admin + auth styles including Preact islands (scoped styles don't reach islands)
- `_variables.scss` / `_mixins.scss` — design tokens and shared mixins

Use SCSS variables from `_variables.scss` — never hardcode colors or breakpoints. Key variables: `$color-card-bg`, `$color-tag-bg`, `$color-btn-*`, `$border-radius`, `$breakpoint-*`, `$font-*`.

## admin.scss Is Canonical for Preact Islands

This is the ONLY stylesheet that reaches Preact components in `src/components/admin/`. If styles "work in Astro but not in the component", the cause is almost always scoped CSS. Move to admin.scss.

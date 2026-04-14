/**
 * Map Style Swatch
 * ================
 *
 * Single source of truth for overlay line styles on the map.
 * All map rendering code reads from here — never hardcode widths,
 * opacities, or colors in layer setup.
 *
 * Two contexts, two roles:
 *
 *   ROUTES foreground — curated route polylines are the star.
 *     Bike path overlay is background context (thin, faded).
 *     Base map teal cycling layers stay at full strength.
 *
 *   PATHS foreground — bike path overlay is the star.
 *     Base map teal cycling layers mute (they're the same data).
 *     Overlay distinguishes interactive (has page) from other.
 */

// ---------------------------------------------------------------------------
// Route overlay — when routes are the main content
// ---------------------------------------------------------------------------

export const route = {
  color: '#350091',        // deep purple — the signature
  colorHC: '#0077BB',      // high-contrast: accessible blue
  width: 6,
  opacity: 0.9,
} as const;

// ---------------------------------------------------------------------------
// Path overlay — when bike paths are the main content (foreground)
// ---------------------------------------------------------------------------

export const pathForeground = {
  color: '#350091',

  interactive: {
    width: 4,
    opacity: 0.8,
  },

  other: {
    width: 2.5,
    opacity: 0.1,
  },

  hover: {
    width: 6,              // interactive width + 2
    opacity: 1.0,
    dimOpacity: 0,          // hide non-hovered paths entirely
  },

  highlight: {
    width: 6,              // category/network selection
    opacity: 1.0,
    dimInteractive: 0,     // hide non-highlighted interactive paths
    dimOther: 0,            // hide non-highlighted other paths
  },
} as const;

// ---------------------------------------------------------------------------
// Path overlay — when bike paths are background to routes
// ---------------------------------------------------------------------------

export const pathBackground = {
  color: '#350091',

  interactive: {
    width: [[8, 2], [12, 4], [14, 6]] as readonly (readonly [number, number])[],
    opacity: 0.8,
  },

  other: {
    width: [[8, 1], [12, 2], [14, 4]] as readonly (readonly [number, number])[],
    opacity: [[8, 0.08], [12, 0.2], [14, 0.45]] as readonly (readonly [number, number])[],
  },
} as const;

// ---------------------------------------------------------------------------
// Base map cycling layers — runtime opacity control
// ---------------------------------------------------------------------------

export const baseCycling = {
  /** Opacity when paths are foreground (muted — overlay owns the story) */
  mutedOpacity: 0.3,
  /** Opacity when routes are foreground (full — teal adds context) */
  normalOpacity: 1,        // null = restore style-spec defaults
} as const;

// ---------------------------------------------------------------------------
// Path detail page — highlighted path + faded context
// ---------------------------------------------------------------------------

export const pathDetail = {
  color: '#350091',

  highlighted: {
    width: [[8, 2], [12, 4], [14, 6]] as readonly (readonly [number, number])[],
    opacity: 0.8,
  },

  context: {
    width: [[8, 0.5], [12, 1], [14, 2]] as readonly (readonly [number, number])[],
    opacity: [[8, 0.04], [12, 0.08], [14, 0.15]] as readonly (readonly [number, number])[],
  },
} as const;

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

/** Dash pattern for trails (path_type: trail | mtb-trail) */
export const TRAIL_DASH: [number, number] = [3, 1];

/** MapLibre expression: true when path_type is trail AND surface is not paved.
 *  Paved trail segments render as solid lines, unpaved as dashed. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const IS_TRAIL_EXPR: any =
  ['all',
    ['in', ['get', 'path_type'], ['literal', ['trail', 'mtb-trail']]],
    ['!=', ['get', 'surface'], 'paved'],
  ];

/** Tour palette — 8 accessible colors for multi-ride maps */
export const TOUR_PALETTE = [
  '#E6194B', // red
  '#3CB44B', // green
  '#4363D8', // blue
  '#F58231', // orange
  '#911EB4', // purple
  '#42D4F4', // cyan
  '#F032E6', // magenta
  '#BFEF45', // lime
] as const;

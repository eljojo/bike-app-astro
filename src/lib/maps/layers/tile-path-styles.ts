// src/lib/maps/layers/tile-path-styles.ts
//
// MapLibre layer definitions for the bike path tile overlay.
// Three surface categories: road (solid), gravel (long dash), mtb (short dash).

import type maplibregl from 'maplibre-gl';
import { pathForeground, pathBackground, pathDetail, GRAVEL_DASH, MTB_DASH, IS_GRAVEL_EXPR, IS_MTB_EXPR } from '../map-swatch';

// ── Source and layer IDs ────────────────────────────────────────

export const SOURCE_ID = 'paths-network';

export const LINE_LAYERS = ['paths-network-line', 'paths-network-line-gravel', 'paths-network-line-mtb'];
export const BG_LAYERS = ['paths-network-bg', 'paths-network-bg-gravel', 'paths-network-bg-mtb'];
export const CLICKABLE_LAYERS = [
  ...LINE_LAYERS, ...BG_LAYERS,
  'paths-network-highlight',
];
export const ALL_LAYER_IDS = [
  ...BG_LAYERS, ...LINE_LAYERS,
  'paths-network-labels', 'paths-network-highlight',
];

// ── Paint helpers ───────────────────────────────────────────────

type PaintValue = number | readonly (readonly [number, number])[];

function zoomInterp(stops: readonly (readonly [number, number])[]): maplibregl.ExpressionSpecification {
  return ['interpolate', ['linear'], ['zoom'], ...stops.flatMap(([z, v]) => [z, v])] as unknown as maplibregl.ExpressionSpecification;
}

function resolvePaint(value: PaintValue): number | maplibregl.ExpressionSpecification {
  return typeof value === 'number' ? value : zoomInterp(value);
}

// ── Mode config ─────────────────────────────────────────────────

interface LayerPaint {
  width: PaintValue;
  opacity: PaintValue;
}

interface PathLayersConfig {
  color: string;
  /** Property name to split primary (highlighted/interactive) from secondary */
  filterProp: string;
  primary: LayerPaint;
  secondary: LayerPaint;
  addHighlight: boolean;
}

function configForMode(isDetailMode: boolean, foreground: boolean): PathLayersConfig {
  if (isDetailMode) {
    return {
      color: pathDetail.color,
      filterProp: 'highlight',
      primary: { width: pathDetail.highlighted.width, opacity: pathDetail.highlighted.opacity },
      secondary: { width: pathDetail.context.width, opacity: pathDetail.context.opacity },
      addHighlight: false,
    };
  }
  if (foreground) {
    return {
      color: pathForeground.color,
      filterProp: 'interactive',
      primary: { width: pathForeground.interactive.width, opacity: pathForeground.interactive.opacity },
      secondary: { width: pathForeground.other.width, opacity: pathForeground.other.opacity },
      addHighlight: true,
    };
  }
  return {
    color: pathBackground.color,
    filterProp: 'interactive',
    primary: { width: pathBackground.interactive.width, opacity: pathBackground.interactive.opacity },
    secondary: { width: pathBackground.other.width, opacity: pathBackground.other.opacity },
    addHighlight: false,
  };
}

// ── Filter helpers ──────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Filter = any;

/** Filter for a specific surface category (road, gravel, or mtb) × primary/secondary. */
function lineFilter(filterProp: string, match: boolean, surface: 'road' | 'gravel' | 'mtb'): Filter {
  const propFilter = match
    ? ['==', ['get', filterProp], 'true']
    : ['!=', ['get', filterProp], 'true'];

  const surfaceFilter = surface === 'gravel' ? IS_GRAVEL_EXPR
    : surface === 'mtb' ? IS_MTB_EXPR
    : ['all', ['!', IS_GRAVEL_EXPR], ['!', IS_MTB_EXPR]]; // road = neither gravel nor mtb

  return ['all', propFilter, surfaceFilter];
}

function propMatch(filterProp: string): Filter {
  return ['==', ['get', filterProp], 'true'];
}

// ── Layer creation ──────────────────────────────────────────────

/**
 * Add all MapLibre layers for the bike path tile overlay.
 * Assumes the GeoJSON source (SOURCE_ID) has already been added to the map.
 */
export function addPathLayers(map: maplibregl.Map, isDetailMode: boolean, foreground: boolean): void {
  const cfg = configForMode(isDetailMode, foreground);
  const { color, filterProp } = cfg;

  // Background: road (solid)
  map.addLayer({
    id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
    filter: lineFilter(filterProp, false, 'road'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': resolvePaint(cfg.secondary.width), 'line-opacity': resolvePaint(cfg.secondary.opacity) },
  });

  // Background: gravel (long dash)
  map.addLayer({
    id: 'paths-network-bg-gravel', type: 'line', source: SOURCE_ID,
    filter: lineFilter(filterProp, false, 'gravel'),
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': resolvePaint(cfg.secondary.width), 'line-opacity': resolvePaint(cfg.secondary.opacity), 'line-dasharray': GRAVEL_DASH },
  });

  // Background: mtb (short dash)
  map.addLayer({
    id: 'paths-network-bg-mtb', type: 'line', source: SOURCE_ID,
    filter: lineFilter(filterProp, false, 'mtb'),
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': resolvePaint(cfg.secondary.width), 'line-opacity': resolvePaint(cfg.secondary.opacity), 'line-dasharray': MTB_DASH },
  });

  // Foreground: road (solid)
  map.addLayer({
    id: 'paths-network-line', type: 'line', source: SOURCE_ID,
    filter: lineFilter(filterProp, true, 'road'),
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': resolvePaint(cfg.primary.width), 'line-opacity': resolvePaint(cfg.primary.opacity) },
  });

  // Foreground: gravel (long dash)
  map.addLayer({
    id: 'paths-network-line-gravel', type: 'line', source: SOURCE_ID,
    filter: lineFilter(filterProp, true, 'gravel'),
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': resolvePaint(cfg.primary.width), 'line-opacity': resolvePaint(cfg.primary.opacity), 'line-dasharray': GRAVEL_DASH },
  });

  // Foreground: mtb (short dash)
  map.addLayer({
    id: 'paths-network-line-mtb', type: 'line', source: SOURCE_ID,
    filter: lineFilter(filterProp, true, 'mtb'),
    layout: { 'line-cap': 'butt', 'line-join': 'round' },
    paint: { 'line-color': color, 'line-width': resolvePaint(cfg.primary.width), 'line-opacity': resolvePaint(cfg.primary.opacity), 'line-dasharray': MTB_DASH },
  });

  // Labels on primary features
  map.addLayer({
    id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
    filter: propMatch(filterProp),
    minzoom: 11,
    layout: {
      'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-size': 12,
      'text-font': ['Open Sans Regular'], 'text-anchor': 'center', 'text-offset': [0, -1],
      'text-max-angle': 30, 'symbol-spacing': 300, 'text-allow-overlap': false,
    },
    paint: { 'text-color': color, 'text-halo-color': '#ffffff', 'text-halo-width': 2 },
  });

  // Highlight layer (foreground only — for external category/network selection)
  if (cfg.addHighlight) {
    map.addLayer({
      id: 'paths-network-highlight', type: 'line', source: SOURCE_ID,
      filter: ['==', ['get', 'relationId'], ''],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': pathForeground.highlight.width, 'line-opacity': pathForeground.highlight.opacity },
    });
  }
}

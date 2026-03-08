/**
 * Generate a cycling-focused MapLibre GL style for Thunderforest outdoors-v2 tiles.
 *
 * Outputs: public/map-style.json
 *
 * References:
 *   - Tile schema: Thunderforest outdoors-v2
 *     https://www.thunderforest.com/docs/thunderforest.outdoors-v2/
 *   - Tile data: © OpenStreetMap contributors
 *     https://www.openstreetmap.org/copyright
 *   - Cycling color tier system: Mapzen Bike Map / Walkabout style
 *     https://github.com/tangrams/walkabout-style
 *     https://gist.github.com/nvkelso/fe46993c6c334b52c4b9d6cf5aabffa7
 *   - Visual inspiration (warm outdoor palette): MapTiler Outdoor
 *     https://www.openmaptiles.org/styles/
 *   - Cycling layer structure reference: Basemapkit by Jonathan Lurie (MIT)
 *     https://github.com/jonathanlurie/basemapkit
 *   - MapLibre GL style spec:
 *     https://maplibre.org/maplibre-style-spec/
 */

import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';

// ---------------------------------------------------------------------------
// Color palette
// ---------------------------------------------------------------------------

/** Warm, outdoor-inspired base palette */
const base = {
  background: '#f5f3ef',
  earth: '#f0ede8',
  // Landcover
  forest: '#c8dfb3',
  grassland: '#d8e8c4',
  farmland: '#ede9d9',
  scrub: '#c8d7ab',
  wetland: '#d4e6d4',
  glacier: '#e8f0f8',
  sand: '#f5e6c8',
  rock: '#ddd8d0',
  // Landuse
  park: '#c2e4b5',
  residential: '#eae6e0',
  commercial: '#ede0d6',
  industrial: '#e0d8d0',
  school: '#e8dfe8',
  hospital: '#f0dcd8',
  cemetery: '#d0dfc0',
  // Water
  water: '#a0c8e8',
  waterOutline: '#80b0d8',
  stream: '#90b8d8',
  // Buildings
  building: '#d9d0c8',
  buildingOutline: '#c8bfb5',
  // Roads
  motorway: '#e89070',
  motorwayCasing: '#c87058',
  trunk: '#f0a878',
  trunkCasing: '#d08860',
  primary: '#f0c898',
  primaryCasing: '#d0a878',
  secondary: '#f0dca8',
  secondaryCasing: '#d0bc88',
  tertiary: '#ffffff',
  tertiaryCasing: '#d0c8b8',
  minor: '#ffffff',
  minorCasing: '#ddd6c8',
  service: '#ffffff',
  serviceCasing: '#e0d8cc',
  // Rail
  rail: '#b0a8a0',
  railCasing: '#d0c8c0',
  // Boundaries
  countryBorder: '#9898c0',
  stateBorder: '#b0b0c8',
  // Labels
  labelCity: '#333333',
  labelTown: '#444444',
  labelVillage: '#555555',
  labelHalo: '#ffffff',
  roadLabel: '#5c5040',
  roadLabelHalo: '#ffffffcc',
  waterLabel: '#4878a0',
  waterLabelHalo: '#d8e8f0',
  // POIs
  poiDot: '#8a7e70',
  poiLabel: '#6b6055',
  poiLabelHalo: '#ffffffcc',
};

/**
 * Cycling infrastructure colors — adapted from the Mapzen Bike Map tier system.
 *
 * Tier 1a: Dedicated off-road cycleways (highway=cycleway)
 * Tier 1b: Off-road tracks with bicycle access
 * Tier 2:  On-road protected bike infrastructure (cycleway=lane/track)
 * Tier 2m: Minor roads with bike access (living_street, shared)
 * Tier 3:  General bicycle access on roads
 *
 * Original color/tag mapping by Nathaniel V. Kelso (Mapzen):
 *   https://gist.github.com/nvkelso/fe46993c6c334b52c4b9d6cf5aabffa7
 *
 * Mapzen Bike Map blog posts:
 *   https://www.mapzen.com/blog/bike-map/
 *   https://www.mapzen.com/blog/bike-map-v2/
 *
 * Source style (Tangram/YAML, not MapLibre — adapted to GL JSON here):
 *   https://github.com/tangrams/walkabout-style
 */
const cycling = {
  tier1: '#007c6e',       // Dark teal — dedicated cycleways
  tier1Casing: '#00b39e', // Lighter teal casing
  tier1b: '#936454',      // Brown — off-road tracks
  tier1bLite: '#b08b81',  // Light brown — footways with bike access
  tier2: '#ed752b',       // Orange — on-road bike lanes
  tier2Casing: '#f9a18a', // Light orange casing
  tier2Minor: '#6bba91',  // Green — minor roads, shared lanes
  tier3: '#e89e3c',       // Yellow-orange — general bike access
  route: '#2060d0',       // Blue — signed cycling route overlay
  routeCasing: '#ffffff', // White casing for routes
};

// ---------------------------------------------------------------------------
// Font stacks (served by Thunderforest, proxied through /api/tiles/fonts/)
// ---------------------------------------------------------------------------

const font = {
  regular: 'NotoSans_Regular',
  bold: 'NotoSans_Regular', // Thunderforest only has Regular and Italic
  italic: 'NotoSans_Italic',
};

// ---------------------------------------------------------------------------
// Helper: zoom-interpolated line width
// ---------------------------------------------------------------------------

type ZoomWidth = [number, number][];

function lineWidth(stops: ZoomWidth): any {
  return [
    'interpolate', ['exponential', 1.6], ['zoom'],
    ...stops.flatMap(([z, w]) => [z, w]),
  ];
}

// ---------------------------------------------------------------------------
// Layer builder
// ---------------------------------------------------------------------------

type Layer = Record<string, any>;

function buildLayers(): Layer[] {
  return [
    // ===== BACKGROUND & TERRAIN =====
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': base.background },
    },
    // Hillshade — subtle terrain shading
    {
      id: 'hillshade',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'hillshade',
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['get', 'level'],
          110, 'rgba(0,0,0,0.07)',
          170, 'rgba(0,0,0,0)',
          230, 'rgba(255,255,255,0.1)',
        ],
        'fill-antialias': false,
      },
    },

    // ===== LANDCOVER (low zoom) =====
    {
      id: 'landcover-lowzoom',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'landcover-lowzoom',
      maxzoom: 8,
      paint: {
        'fill-color': base.grassland,
        'fill-opacity': 0.5,
      },
    },

    // ===== LANDCOVER =====
    ...['forest', 'grassland', 'farmland', 'scrub', 'wetland', 'glacier', 'sand', 'rock'].map(type => ({
      id: `landcover-${type}`,
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'landcover',
      filter: ['==', 'type', type === 'rock' ? 'bare_rock' : type],
      paint: {
        'fill-color': (base as any)[type] || base.grassland,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.6, 10, 0.4],
      },
    })),

    // ===== LANDUSE =====
    ...([
      ['park', base.park, 0.7],
      ['residential', base.residential, 0.5],
      ['commercial', base.commercial, 0.5],
      ['industrial', base.industrial, 0.5],
      ['school', base.school, 0.5],
      ['hospital', base.hospital, 0.5],
      ['cemetery', base.cemetery, 0.5],
    ] as [string, string, number][]).map(([type, color, opacity]) => ({
      id: `landuse-${type}`,
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'landuse',
      filter: ['==', 'type', type],
      paint: {
        'fill-color': color,
        'fill-opacity': opacity,
      },
    })),

    // ===== WATER =====
    {
      id: 'water',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'water',
      paint: { 'fill-color': base.water },
    },
    {
      id: 'waterway-river',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'waterway',
      filter: ['in', 'waterway', 'river', 'canal'],
      paint: {
        'line-color': base.stream,
        'line-width': lineWidth([[8, 0.5], [14, 3], [18, 8]]),
      },
    },
    {
      id: 'waterway-stream',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'waterway',
      filter: ['in', 'waterway', 'stream', 'ditch', 'drain'],
      paint: {
        'line-color': base.stream,
        'line-width': lineWidth([[12, 0.3], [16, 1.5], [18, 3]]),
      },
    },

    // ===== BUILDINGS =====
    {
      id: 'building',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'building',
      minzoom: 13,
      paint: {
        'fill-color': base.building,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 13, 0, 14, 0.6],
      },
    },
    {
      id: 'building-outline',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'building',
      minzoom: 14,
      paint: {
        'line-color': base.buildingOutline,
        'line-width': 0.5,
      },
    },

    // ===== RAILWAY =====
    {
      id: 'railway-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'railway',
      minzoom: 10,
      paint: {
        'line-color': base.railCasing,
        'line-width': lineWidth([[10, 1], [14, 2], [18, 4]]),
      },
    },
    {
      id: 'railway',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'railway',
      minzoom: 10,
      paint: {
        'line-color': base.rail,
        'line-width': lineWidth([[10, 0.5], [14, 1], [18, 2]]),
        'line-dasharray': [3, 3],
      },
    },

    // ===== ROAD CASINGS (bottom to top by class) =====
    ...roadCasingLayers(),

    // ===== ROAD FILLS (bottom to top by class) =====
    ...roadFillLayers(),

    // ===== CYCLING ON ROADS — cycleway_left / cycleway_right overlays =====
    ...roadCyclewayOverlays(),

    // ===== PATHS — with cycling-specific coloring =====
    ...pathLayers(),

    // ===== CYCLING ROUTE NETWORK =====
    ...cyclingRouteLayers(),

    // ===== BOUNDARIES =====
    {
      id: 'boundary-country',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'country-line',
      paint: {
        'line-color': base.countryBorder,
        'line-width': lineWidth([[2, 0.5], [6, 1.5], [10, 2.5]]),
        'line-dasharray': [5, 2],
      },
    },
    {
      id: 'boundary-state',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'state-line',
      minzoom: 4,
      paint: {
        'line-color': base.stateBorder,
        'line-width': lineWidth([[4, 0.3], [8, 1], [12, 1.5]]),
        'line-dasharray': [4, 3],
      },
    },

    // ===== LABELS =====
    ...labelLayers(),
  ];
}

// ---------------------------------------------------------------------------
// Road layers
// ---------------------------------------------------------------------------

interface RoadClass {
  id: string;
  filter: any;
  fill: string;
  casing: string;
  widthFill: ZoomWidth;
  widthCasing: ZoomWidth;
  minzoom?: number;
}

const roadClasses: RoadClass[] = [
  {
    id: 'motorway',
    filter: ['in', 'highway', 'motorway', 'motorway_link'],
    fill: base.motorway,
    casing: base.motorwayCasing,
    widthFill: [[5, 0.5], [10, 1.5], [14, 5], [18, 14]],
    widthCasing: [[5, 1], [10, 2.5], [14, 7], [18, 18]],
  },
  {
    id: 'trunk',
    filter: ['in', 'highway', 'trunk', 'trunk_link'],
    fill: base.trunk,
    casing: base.trunkCasing,
    widthFill: [[6, 0.4], [10, 1.2], [14, 4], [18, 12]],
    widthCasing: [[6, 0.8], [10, 2], [14, 6], [18, 16]],
  },
  {
    id: 'primary',
    filter: ['in', 'highway', 'primary', 'primary_link'],
    fill: base.primary,
    casing: base.primaryCasing,
    widthFill: [[7, 0.3], [10, 1], [14, 3.5], [18, 10]],
    widthCasing: [[7, 0.7], [10, 1.8], [14, 5.5], [18, 14]],
  },
  {
    id: 'secondary',
    filter: ['in', 'highway', 'secondary', 'secondary_link'],
    fill: base.secondary,
    casing: base.secondaryCasing,
    widthFill: [[8, 0.2], [12, 0.8], [14, 3], [18, 8]],
    widthCasing: [[8, 0.6], [12, 1.5], [14, 5], [18, 12]],
  },
  {
    id: 'tertiary',
    filter: ['in', 'highway', 'tertiary', 'tertiary_link'],
    fill: base.tertiary,
    casing: base.tertiaryCasing,
    widthFill: [[10, 0.2], [14, 2], [18, 6]],
    widthCasing: [[10, 0.5], [14, 3.5], [18, 9]],
    minzoom: 9,
  },
  {
    id: 'minor',
    filter: ['in', 'highway', 'residential', 'unclassified', 'living_street'],
    fill: base.minor,
    casing: base.minorCasing,
    widthFill: [[12, 0.2], [14, 1.5], [18, 5]],
    widthCasing: [[12, 0.5], [14, 2.5], [18, 7]],
    minzoom: 11,
  },
  {
    id: 'service',
    filter: ['==', 'highway', 'service'],
    fill: base.service,
    casing: base.serviceCasing,
    widthFill: [[14, 0.5], [18, 3]],
    widthCasing: [[14, 1], [18, 4.5]],
    minzoom: 13,
  },
];

function roadCasingLayers(): Layer[] {
  return roadClasses.map(rc => ({
    id: `road-casing-${rc.id}`,
    type: 'line',
    source: 'outdoors',
    'source-layer': 'road',
    ...(rc.minzoom ? { minzoom: rc.minzoom } : {}),
    filter: rc.filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': rc.casing,
      'line-width': lineWidth(rc.widthCasing),
    },
  }));
}

function roadFillLayers(): Layer[] {
  return roadClasses.map(rc => ({
    id: `road-fill-${rc.id}`,
    type: 'line',
    source: 'outdoors',
    'source-layer': 'road',
    ...(rc.minzoom ? { minzoom: rc.minzoom } : {}),
    filter: rc.filter,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': rc.fill,
      'line-width': lineWidth(rc.widthFill),
    },
  }));
}

// ---------------------------------------------------------------------------
// Road cycleway overlays — highlight roads with bike infrastructure
// ---------------------------------------------------------------------------

function roadCyclewayOverlays(): Layer[] {
  // Roads that have cycleway_left or cycleway_right get an orange overlay
  // This matches Mapzen Tier 2 (on-road bike infrastructure)
  return [
    {
      id: 'road-cycleway-overlay',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'road',
      minzoom: 12,
      filter: ['any',
        ['has', 'cycleway'],
        ['has', 'cycleway_left'],
        ['has', 'cycleway_right'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.tier2,
        'line-width': lineWidth([[12, 1], [14, 2], [18, 4]]),
        'line-opacity': 0.6,
        'line-offset': 0, // centered — ideally per-side, but offset is complex
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Path layers — cycling infrastructure stands out
// ---------------------------------------------------------------------------

function pathLayers(): Layer[] {
  return [
    // Tier 1a: Dedicated cycleways — dark teal, solid
    {
      id: 'path-cycleway-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 10,
      filter: ['==', 'highway', 'cycleway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.tier1Casing,
        'line-width': lineWidth([[10, 0.8], [14, 3], [18, 7]]),
      },
    },
    {
      id: 'path-cycleway',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 10,
      filter: ['==', 'highway', 'cycleway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.tier1,
        'line-width': lineWidth([[10, 0.5], [14, 2], [18, 5]]),
      },
    },

    // Tier 1b: Paths with bicycle access — lighter teal, dashed
    {
      id: 'path-bicycle-access',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 12,
      filter: ['all',
        ['in', 'highway', 'path', 'footway'],
        ['in', 'bicycle', 'yes', 'designated', 'permissive'],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.tier1,
        'line-width': lineWidth([[12, 0.5], [14, 1.5], [18, 3.5]]),
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    },

    // Tier 1b: Tracks with bicycle access — brown, dashed
    {
      id: 'path-track-bicycle',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 12,
      filter: ['all',
        ['==', 'highway', 'track'],
        ['in', 'bicycle', 'yes', 'designated', 'permissive'],
      ],
      paint: {
        'line-color': cycling.tier1b,
        'line-width': lineWidth([[12, 0.5], [14, 1.5], [18, 3]]),
        'line-dasharray': [3, 2],
      },
    },

    // Generic paths (no bicycle tag) — subtle grey dashes
    {
      id: 'path-generic',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 13,
      filter: ['all',
        ['in', 'highway', 'path', 'footway', 'track'],
        ['!in', 'bicycle', 'yes', 'designated', 'permissive'],
        ['!=', 'highway', 'cycleway'],
      ],
      paint: {
        'line-color': '#b0a898',
        'line-width': lineWidth([[13, 0.3], [16, 1], [18, 2]]),
        'line-dasharray': [2, 2],
        'line-opacity': 0.6,
      },
    },

    // Steps — dotted
    {
      id: 'path-steps',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 14,
      filter: ['==', 'highway', 'steps'],
      paint: {
        'line-color': '#c0b8a8',
        'line-width': lineWidth([[14, 1], [18, 3]]),
        'line-dasharray': [1, 1],
      },
    },

    // Bridleway — light brown dots
    {
      id: 'path-bridleway',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 13,
      filter: ['==', 'highway', 'bridleway'],
      paint: {
        'line-color': cycling.tier1bLite,
        'line-width': lineWidth([[13, 0.5], [16, 1.5], [18, 3]]),
        'line-dasharray': [2, 3],
        'line-opacity': 0.6,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Cycling route network — signed routes overlay
// ---------------------------------------------------------------------------

function cyclingRouteLayers(): Layer[] {
  return [
    // Low-zoom cycling routes — visible from zoom 5
    {
      id: 'cycling-route-lowzoom-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'cycling-lowzoom',
      minzoom: 5,
      maxzoom: 10,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.routeCasing,
        'line-width': lineWidth([[5, 1.5], [8, 3], [10, 4]]),
        'line-opacity': 0.6,
      },
    },
    {
      id: 'cycling-route-lowzoom',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'cycling-lowzoom',
      minzoom: 5,
      maxzoom: 10,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.route,
        'line-width': lineWidth([[5, 0.8], [8, 1.5], [10, 2]]),
        'line-opacity': 0.7,
      },
    },

    // Detailed cycling routes — visible from zoom 8
    {
      id: 'cycling-route-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'cycling',
      minzoom: 8,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.routeCasing,
        'line-width': lineWidth([[8, 2], [12, 4], [16, 6]]),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 0.6],
      },
    },
    {
      id: 'cycling-route',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'cycling',
      minzoom: 8,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.route,
        'line-width': lineWidth([[8, 1], [12, 2], [16, 3]]),
        'line-opacity': 0.7,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function labelLayers(): Layer[] {
  return [
    // Water labels
    {
      id: 'label-water',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'water',
      minzoom: 10,
      filter: ['has', 'name'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 10, 16, 14],
        'text-max-width': 7,
        'symbol-placement': 'point',
      },
      paint: {
        'text-color': base.waterLabel,
        'text-halo-color': base.waterLabelHalo,
        'text-halo-width': 1.5,
      },
    },

    // Road labels
    {
      id: 'label-road-major',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'road',
      minzoom: 12,
      filter: ['in', 'highway', 'primary', 'secondary', 'tertiary'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 16, 12],
        'symbol-placement': 'line',
        'text-max-angle': 30,
        'text-rotation-alignment': 'map',
        'text-pitch-alignment': 'viewport',
      },
      paint: {
        'text-color': base.roadLabel,
        'text-halo-color': base.roadLabelHalo,
        'text-halo-width': 2,
      },
    },
    {
      id: 'label-road-minor',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'road',
      minzoom: 14,
      filter: ['in', 'highway', 'residential', 'unclassified', 'living_street'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 8, 18, 11],
        'symbol-placement': 'line',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': base.roadLabel,
        'text-halo-color': base.roadLabelHalo,
        'text-halo-width': 1.5,
      },
    },

    // Cycleway labels — use cycling color for path names
    {
      id: 'label-cycleway',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 14,
      filter: ['all', ['==', 'highway', 'cycleway'], ['has', 'name']],
      layout: {
        'text-field': '{name}',
        'text-font': [font.bold],
        'text-size': ['interpolate', ['linear'], ['zoom'], 14, 9, 18, 12],
        'symbol-placement': 'line',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': cycling.tier1,
        'text-halo-color': '#ffffffcc',
        'text-halo-width': 2,
      },
    },

    // Cycling node network labels
    {
      id: 'label-cycling-node',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'cycling-node-network-label',
      minzoom: 12,
      layout: {
        'text-field': '{ref}',
        'text-font': [font.bold],
        'text-size': 12,
        'text-padding': 5,
      },
      paint: {
        'text-color': cycling.route,
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    },

    // POI labels — subtle dots + names from tile data
    // (Curated places from bike-routes are rendered as DOM markers on top by map-init.ts)
    {
      id: 'poi-dot',
      type: 'circle',
      source: 'outdoors',
      'source-layer': 'poi-label',
      minzoom: 14,
      filter: ['has', 'name'],
      paint: {
        'circle-color': base.poiDot,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 2, 18, 4],
        'circle-opacity': 0.6,
      },
    },
    {
      id: 'poi-name',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'poi-label',
      minzoom: 15,
      filter: ['has', 'name'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 15, 9, 18, 11],
        'text-offset': [0, 1.2],
        'text-anchor': 'top',
        'text-max-width': 8,
        'text-optional': true,
      },
      paint: {
        'text-color': base.poiLabel,
        'text-halo-color': base.poiLabelHalo,
        'text-halo-width': 1.5,
        'text-opacity': 0.8,
      },
    },

    // Place labels — cities, towns, villages
    {
      id: 'label-city',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'place-label',
      filter: ['==', 'place', 'city'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.bold],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 10, 18, 14, 24],
        'text-max-width': 8,
      },
      paint: {
        'text-color': base.labelCity,
        'text-halo-color': base.labelHalo,
        'text-halo-width': 2,
      },
    },
    {
      id: 'label-town',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'place-label',
      minzoom: 6,
      filter: ['==', 'place', 'town'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.bold],
        'text-size': ['interpolate', ['linear'], ['zoom'], 6, 8, 12, 14, 16, 18],
        'text-max-width': 7,
      },
      paint: {
        'text-color': base.labelTown,
        'text-halo-color': base.labelHalo,
        'text-halo-width': 1.5,
      },
    },
    {
      id: 'label-village',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'place-label',
      minzoom: 8,
      filter: ['in', 'place', 'village', 'hamlet', 'suburb'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 8, 14, 13, 18, 16],
        'text-max-width': 6,
      },
      paint: {
        'text-color': base.labelVillage,
        'text-halo-color': base.labelHalo,
        'text-halo-width': 1.5,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Build the full style
// ---------------------------------------------------------------------------

function buildMapStyle() {
  return {
    version: 8,
    name: 'Cycling',
    sources: {
      outdoors: {
        type: 'vector',
        tiles: ['/api/tiles/thunderforest.outdoors-v2/{z}/{x}/{y}.vector.pbf'],
        minzoom: 0,
        maxzoom: 14,
        attribution: '&copy; <a href="https://www.thunderforest.com">Thunderforest</a>, &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      },
    },
    glyphs: '/api/tiles/fonts/{fontstack}/{range}.pbf',
    layers: buildLayers(),
  };
}

// ---------------------------------------------------------------------------
// Main — generate fingerprinted map-style.[hash].json + URL module
// ---------------------------------------------------------------------------

const root = path.resolve(import.meta.dirname || __dirname, '..');
const style = buildMapStyle();
const json = JSON.stringify(style, null, 2);
const hash = crypto.createHash('md5').update(json).digest('hex').slice(0, 8);
const filename = `map-style.${hash}.json`;

// Clean old fingerprinted files
for (const f of fs.readdirSync(path.join(root, 'public'))) {
  if (f.startsWith('map-style.') && f.endsWith('.json')) fs.unlinkSync(path.join(root, 'public', f));
}

fs.writeFileSync(path.join(root, 'public', filename), json);

// Write importable URL module so all consumers get the hashed path
fs.writeFileSync(
  path.join(root, 'src', 'lib', 'map-style-url.ts'),
  `// Generated by scripts/build-map-style.ts — do not edit\nexport const MAP_STYLE_URL = '/${filename}';\n`,
);

console.log(`[map-style] Generated ${filename} (${style.layers.length} layers)`);

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
  forest: '#b4d89c',
  grassland: '#cce0b5',
  farmland: '#ede9d9',
  scrub: '#c8d7ab',
  wetland: '#d4e6d4',
  glacier: '#e8f0f8',
  sand: '#f0d8a0',
  rock: '#ddd8d0',
  // Landuse
  park: '#a8d898',
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
  // Roads — subdued but readable; enough contrast to see street grid
  road: '#e2dfd8',
  roadCasing: '#d6d2ca',
  service: '#e8e5de',
  serviceCasing: '#dfdcd5',
  // Rail
  rail: '#ccc6be',
  railCasing: '#ddd8d0',
  // Boundaries
  countryBorder: '#9898c0',
  stateBorder: '#b0b0c8',
  // Labels
  labelCity: '#333333',
  labelTown: '#444444',
  labelVillage: '#555555',
  labelHalo: '#ffffff',
  roadLabel: '#9e968a',
  roadLabelHalo: '#ffffffcc',
  waterLabel: '#4878a0',
  waterLabelHalo: '#d8e8f0',
  // Transit
  station: '#2a2a3a',
  stationHalo: '#ffffff',
  // Contours
  contour: '#c4b8a8',
  contourLabel: '#a89880',
  // POIs
  poiDot: '#8a7e70',
  poiLabel: '#6b6055',
  poiLabelHalo: '#ffffffcc',
};

/**
 * Cycling infrastructure — 4 colors, 4 concepts:
 *
 *   Teal   = Safe, segregated (cycleways + paths with bicycle access)
 *   Brown  = Gravel/dirt (off-road tracks)
 *   Orange = On-road bike lanes (shared with cars)
 *   Blue   = Signed cycling route network overlay
 *
 * Adapted from the Mapzen Bike Map tier system by Nathaniel V. Kelso:
 *   https://gist.github.com/nvkelso/fe46993c6c334b52c4b9d6cf5aabffa7
 *   https://www.mapzen.com/blog/bike-map/
 *   https://github.com/tangrams/walkabout-style
 */
const cycling = {
  safe: '#006458',        // Deep teal — segregated bike infra (cycleways + bike-access paths)
  safeCasing: '#009e88',  // Teal casing
  gravel: '#7a4e3c',      // Dark brown — off-road tracks, gravel
  onRoad: '#3a8878',      // Muted teal — on-road bike lanes (same family, less confident)
  route: '#1a50b8',       // Deep blue — signed cycling route network
  routeCasing: '#ffffff', // White casing for route overlay
  hiking: '#6b5038',      // Dark warm brown — hiking trails (off-road, nature)
  hikingCasing: '#ffffff', // White casing for visibility
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
    // Hillshade — terrain shading so hills are visible
    {
      id: 'hillshade',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'hillshade',
      paint: {
        'fill-color': [
          'interpolate', ['linear'], ['get', 'level'],
          110, 'rgba(0,0,0,0.15)',
          170, 'rgba(0,0,0,0)',
          230, 'rgba(255,255,255,0.15)',
        ],
        'fill-antialias': false,
      },
    },

    // ===== CONTOUR LINES =====
    // Minor contours — every contour line, thin
    {
      id: 'contour-line',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'elevation',
      minzoom: 12,
      paint: {
        'line-color': base.contour,
        'line-width': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 16, 0.6],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 12, 0.3, 14, 0.4],
      },
    },
    // Major contours — every 50m, thicker
    {
      id: 'contour-line-major',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'elevation',
      minzoom: 11,
      filter: ['==', ['%', ['get', 'height'], 50], 0],
      paint: {
        'line-color': base.contour,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.4, 14, 1, 16, 1.2],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 11, 0.3, 14, 0.5],
      },
    },
    // Contour labels — height in metres on major contours
    {
      id: 'contour-label',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'elevation',
      minzoom: 13,
      filter: ['==', ['%', ['get', 'height'], 50], 0],
      layout: {
        'text-field': ['concat', ['to-string', ['get', 'height']], 'm'],
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 8, 16, 10],
        'symbol-placement': 'line',
        'text-max-angle': 25,
        'text-padding': 40,
      },
      paint: {
        'text-color': base.contourLabel,
        'text-halo-color': '#ffffffcc',
        'text-halo-width': 1.5,
      },
    },

    // ===== LANDCOVER (low zoom — value 0-16 classification) =====
    // 0=water, 1-5=forest types, 6-7=shrubland, 8-9=savanna,
    // 10=grassland, 11=wetland, 12-14=cropland, 15=urban, 16=barren
    {
      id: 'landcover-lowzoom',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'landcover-lowzoom',
      maxzoom: 8,
      paint: {
        'fill-color': [
          'match', ['get', 'value'],
          0, base.water,                                    // water
          1, base.forest, 2, base.forest,                   // evergreen forest
          3, base.forest, 4, base.forest, 5, base.forest,  // deciduous/mixed forest
          6, base.scrub, 7, base.scrub,                     // shrubland
          8, base.grassland, 9, base.grassland,             // savanna
          10, base.grassland,                               // grassland
          11, base.wetland,                                 // wetland
          12, base.farmland, 13, base.farmland, 14, base.farmland, // cropland
          16, base.rock,                                    // barren
          base.earth,                                       // fallback
        ],
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 2, 0.6, 6, 0.5, 8, 0.4],
      },
    },

    // ===== LANDCOVER =====
    // Forest gets stronger treatment — it's where trails are
    {
      id: 'landcover-forest',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'landcover',
      filter: ['==', 'type', 'forest'],
      paint: {
        'fill-color': base.forest,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 10, 0.6, 14, 0.55],
      },
    },
    // Sand/beaches — warm yellow, stands out as a destination
    {
      id: 'landcover-sand',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'landcover',
      filter: ['==', 'type', 'sand'],
      paint: {
        'fill-color': base.sand,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 6, 0.7, 10, 0.65, 14, 0.6],
      },
    },
    ...['grassland', 'farmland', 'scrub', 'wetland', 'glacier', 'rock'].map(type => ({
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
      ['park', base.park, 0.85],
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

    // ===== PROTECTED AREAS (national/provincial parks, nature reserves) =====
    {
      id: 'protected-area',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'protected-area',
      paint: {
        'fill-color': base.park,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 5, 0.5, 10, 0.6, 14, 0.5],
      },
    },
    {
      id: 'protected-area-outline',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'protected-area',
      minzoom: 8,
      paint: {
        'line-color': '#7cba68',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 1.5, 16, 2],
        'line-dasharray': [4, 2],
        'line-opacity': 0.6,
      },
    },

    // ===== WETLAND (dedicated layer — more detail than landcover wetland) =====
    {
      id: 'wetland',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'wetland',
      paint: {
        'fill-color': base.wetland,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.4, 12, 0.6],
      },
    },
    {
      id: 'wetland-outline',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'wetland',
      minzoom: 10,
      paint: {
        'line-color': '#a0c8a0',
        'line-width': 0.8,
        'line-dasharray': [3, 2],
        'line-opacity': 0.5,
      },
    },

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

    // ===== WATER FEATURES (waterfalls, springs, fountains, dams) =====
    {
      id: 'water-feature',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'water-feature',
      minzoom: 12,
      paint: {
        'line-color': base.waterOutline,
        'line-width': 1.5,
        'line-opacity': 0.7,
      },
    },

    // ===== FERRY ROUTES =====
    {
      id: 'ferry',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'ferry',
      minzoom: 8,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': base.waterOutline,
        'line-width': lineWidth([[8, 0.5], [12, 1.5], [16, 2.5]]),
        'line-dasharray': [6, 4],
        'line-opacity': 0.7,
      },
    },

    // ===== BUILDINGS =====
    {
      id: 'building',
      type: 'fill',
      source: 'outdoors',
      'source-layer': 'building',
      minzoom: 15,
      paint: {
        'fill-color': base.building,
        'fill-opacity': ['interpolate', ['linear'], ['zoom'], 15, 0, 16, 0.5],
      },
    },
    {
      id: 'building-outline',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'building',
      minzoom: 16,
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

    // ===== HIKING ROUTE NETWORK =====
    ...hikingRouteLayers(),

    // ===== MOUNTAIN BIKING ROUTES =====
    ...mountainBikingLayers(),

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
  // All car roads share one color — no visual hierarchy for cars
  {
    id: 'major',
    filter: ['in', 'highway', 'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link'],
    fill: base.road,
    casing: base.roadCasing,
    widthFill: [[7, 0.2], [10, 0.5], [14, 1.5], [18, 4]],
    widthCasing: [[7, 0.4], [10, 0.9], [14, 2.5], [18, 6]],
    minzoom: 5,
  },
  {
    id: 'secondary',
    filter: ['in', 'highway', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link'],
    fill: base.road,
    casing: base.roadCasing,
    widthFill: [[8, 0.2], [12, 0.4], [14, 1.2], [18, 3]],
    widthCasing: [[8, 0.4], [12, 0.8], [14, 2], [18, 4.5]],
    minzoom: 9,
  },
  {
    id: 'minor',
    filter: ['in', 'highway', 'residential', 'unclassified', 'living_street'],
    fill: base.road,
    casing: base.roadCasing,
    widthFill: [[12, 0.2], [14, 0.8], [18, 2.5]],
    widthCasing: [[12, 0.4], [14, 1.5], [18, 4]],
    minzoom: 12,
  },
  {
    id: 'service',
    filter: ['==', 'highway', 'service'],
    fill: base.service,
    casing: base.serviceCasing,
    widthFill: [[14, 0.3], [18, 1.5]],
    widthCasing: [[14, 0.6], [18, 2.5]],
    minzoom: 14,
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
  // Roads with cycleway tags get a light teal overlay — same bike family, softer
  return [
    {
      id: 'road-cycleway-overlay',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'road',
      minzoom: 10,
      filter: ['any',
        ['has', 'cycleway'],
        ['has', 'cycleway_left'],
        ['has', 'cycleway_right'],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.onRoad,
        'line-width': lineWidth([[10, 0.5], [12, 1], [14, 2], [18, 4]]),
        'line-opacity': 0.75,
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
    // Safe: Dedicated cycleways — teal, solid
    {
      id: 'path-cycleway-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 8,
      filter: ['==', 'highway', 'cycleway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.safeCasing,
        'line-width': lineWidth([[8, 0.5], [10, 0.8], [14, 3], [18, 7]]),
      },
    },
    {
      id: 'path-cycleway',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 8,
      filter: ['==', 'highway', 'cycleway'],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.safe,
        'line-width': lineWidth([[8, 0.3], [10, 0.5], [14, 2], [18, 5]]),
      },
    },

    // Safe: Paths with bicycle access — teal, dashed
    {
      id: 'path-bicycle-access',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 10,
      filter: ['all',
        ['in', 'highway', 'path', 'footway'],
        ['in', 'bicycle', 'yes', 'designated', 'permissive'],
      ],
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.safe,
        'line-width': lineWidth([[10, 0.3], [12, 0.5], [14, 1.5], [18, 3.5]]),
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    },

    // Gravel: Tracks with bicycle access — brown, dashed
    {
      id: 'path-track-bicycle',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'path',
      minzoom: 10,
      filter: ['all',
        ['==', 'highway', 'track'],
        ['in', 'bicycle', 'yes', 'designated', 'permissive'],
      ],
      paint: {
        'line-color': cycling.gravel,
        'line-width': lineWidth([[10, 0.3], [12, 0.5], [14, 1.5], [18, 3]]),
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
        'line-color': '#b0a898',
        'line-width': lineWidth([[13, 0.5], [16, 1.5], [18, 3]]),
        'line-dasharray': [2, 3],
        'line-opacity': 0.6,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Hiking route network — off-road nature trails
// ---------------------------------------------------------------------------

function hikingRouteLayers(): Layer[] {
  return [
    {
      id: 'hiking-route-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'hiking',
      minzoom: 10,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': cycling.hikingCasing,
        'line-width': lineWidth([[10, 1.5], [14, 3.5], [18, 6]]),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.6],
      },
    },
    {
      id: 'hiking-route',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'hiking',
      minzoom: 10,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.hiking,
        'line-width': lineWidth([[10, 0.8], [14, 2], [18, 4]]),
        'line-dasharray': [4, 2],
        'line-opacity': 0.7,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Mountain biking routes — gravel/off-road
// ---------------------------------------------------------------------------

function mountainBikingLayers(): Layer[] {
  return [
    {
      id: 'mtb-route-casing',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'mountain-biking',
      minzoom: 10,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': lineWidth([[10, 1.5], [14, 3.5], [18, 6]]),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 10, 0.4, 14, 0.6],
      },
    },
    {
      id: 'mtb-route',
      type: 'line',
      source: 'outdoors',
      'source-layer': 'mountain-biking',
      minzoom: 10,
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: {
        'line-color': cycling.gravel,
        'line-width': lineWidth([[10, 0.8], [14, 2], [18, 4]]),
        'line-dasharray': [3, 1.5],
        'line-opacity': 0.75,
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
        'line-width': lineWidth([[5, 2], [8, 4], [10, 6]]),
        'line-opacity': 0.7,
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
        'line-width': lineWidth([[5, 1.2], [8, 2.5], [10, 4]]),
        'line-opacity': 0.8,
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
        'line-width': lineWidth([[8, 3], [12, 5], [16, 8]]),
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 12, 0.7],
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
        'line-width': lineWidth([[8, 1.5], [12, 3], [16, 5]]),
        'line-opacity': 0.8,
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

function labelLayers(): Layer[] {
  return [
    // Green space labels — parks, forests, gardens, nature reserves (visible zoomed out)
    {
      id: 'label-park',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'landuse',
      minzoom: 9,
      filter: ['all', ['in', 'landuse', 'park', 'recreation_ground', 'garden', 'village_green', 'forest', 'meadow', 'grass', 'nature_reserve', 'wood'], ['has', 'name']],
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 9, 10, 12, 13, 16, 16],
        'text-max-width': 7,
        'symbol-placement': 'point',
        'text-padding': 8,
        'text-optional': true,
      },
      paint: {
        'text-color': '#3a7a30',
        'text-halo-color': '#ffffffcc',
        'text-halo-width': 2,
      },
    },

    // Protected area labels (park names like "Gatineau Park")
    {
      id: 'label-protected-area',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'protected-area-label',
      minzoom: 8,
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 8, 10, 12, 14, 16, 16],
        'text-max-width': 8,
        'symbol-placement': 'point',
        'text-padding': 10,
      },
      paint: {
        'text-color': '#3a7a30',
        'text-halo-color': '#ffffffcc',
        'text-halo-width': 2,
      },
    },

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
      minzoom: 12,
      filter: ['all', ['==', 'highway', 'cycleway'], ['has', 'name']],
      layout: {
        'text-field': '{name}',
        'text-font': [font.bold],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 8, 14, 10, 18, 12],
        'symbol-placement': 'line',
        'text-max-angle': 30,
      },
      paint: {
        'text-color': cycling.safe,
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

    // Hiking route labels
    {
      id: 'label-hiking',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'hiking-label',
      minzoom: 12,
      filter: ['has', 'name'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 12, 8, 16, 11],
        'symbol-placement': 'line',
        'text-max-angle': 25,
        'text-padding': 30,
      },
      paint: {
        'text-color': cycling.hiking,
        'text-halo-color': '#ffffffcc',
        'text-halo-width': 1.5,
      },
    },

    // POI labels — subtle dots + names from tile data
    // (Curated places from bike-routes are rendered as DOM markers on top by map-init.ts)
    {
      id: 'poi-dot',
      type: 'circle',
      source: 'outdoors',
      'source-layer': 'poi-label',
      minzoom: 16,
      filter: ['has', 'name'],
      paint: {
        'circle-color': base.poiDot,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 16, 2, 18, 4],
        'circle-opacity': 0.6,
      },
    },
    {
      id: 'poi-name',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'poi-label',
      minzoom: 16,
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

    // Train / subway / LRT stations — prominent landmarks for navigation
    {
      id: 'station-dot',
      type: 'circle',
      source: 'outdoors',
      'source-layer': 'railway-station',
      minzoom: 10,
      paint: {
        'circle-color': base.station,
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 4, 14, 7, 18, 10],
        'circle-stroke-width': 2,
        'circle-stroke-color': base.stationHalo,
        'circle-opacity': 0.9,
      },
    },
    {
      id: 'station-label',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'railway-station',
      minzoom: 11,
      layout: {
        'text-field': '{name}',
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 13, 18, 15],
        'text-offset': [0, 1.4],
        'text-anchor': 'top',
        'text-max-width': 9,
        'text-optional': true,
      },
      paint: {
        'text-color': base.station,
        'text-halo-color': base.stationHalo,
        'text-halo-width': 2,
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

    // State/province labels (Ontario, Quebec, etc.)
    {
      id: 'label-state',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'state-label',
      minzoom: 4,
      maxzoom: 8,
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 10, 7, 16],
        'text-max-width': 8,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.15,
      },
      paint: {
        'text-color': '#7a7a9a',
        'text-halo-color': base.labelHalo,
        'text-halo-width': 2,
        'text-opacity': 0.7,
      },
    },

    // Country labels
    {
      id: 'label-country',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'country-label',
      maxzoom: 6,
      layout: {
        'text-field': '{name}',
        'text-font': [font.bold],
        'text-size': ['interpolate', ['linear'], ['zoom'], 2, 10, 5, 18],
        'text-max-width': 8,
        'text-transform': 'uppercase',
        'text-letter-spacing': 0.2,
      },
      paint: {
        'text-color': '#6a6a8a',
        'text-halo-color': base.labelHalo,
        'text-halo-width': 2,
      },
    },

    // Ferry labels
    {
      id: 'label-ferry',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'ferry',
      minzoom: 10,
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 10, 9, 14, 11],
        'symbol-placement': 'line',
        'text-max-angle': 25,
      },
      paint: {
        'text-color': base.waterLabel,
        'text-halo-color': base.waterLabelHalo,
        'text-halo-width': 1.5,
      },
    },

    // Water feature labels (waterfalls, springs, dams)
    {
      id: 'label-water-feature',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'water-feature',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.italic],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 11],
        'text-offset': [0, 1],
        'text-anchor': 'top',
        'text-max-width': 7,
      },
      paint: {
        'text-color': base.waterLabel,
        'text-halo-color': base.waterLabelHalo,
        'text-halo-width': 1.5,
      },
    },

    // Path labels — names of paths/trails (supplements cycleway labels with broader path coverage)
    {
      id: 'label-path',
      type: 'symbol',
      source: 'outdoors',
      'source-layer': 'path-label',
      minzoom: 13,
      filter: ['has', 'name'],
      layout: {
        'text-field': '{name}',
        'text-font': [font.regular],
        'text-size': ['interpolate', ['linear'], ['zoom'], 13, 9, 16, 11],
        'symbol-placement': 'line',
        'text-max-angle': 25,
      },
      paint: {
        'text-color': cycling.safe,
        'text-halo-color': '#ffffffcc',
        'text-halo-width': 2,
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

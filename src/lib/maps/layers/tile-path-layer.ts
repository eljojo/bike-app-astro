// src/lib/maps/layers/tile-path-layer.ts
//
// Orchestrator for the bike path tile overlay.
// Delegates layer creation to tile-path-styles and interaction wiring
// to tile-path-interactions. Owns lifecycle, tile loading, and public API.

import maplibregl from 'maplibre-gl';
import { pathForeground } from '../map-swatch';
import { createTileLoader, type TileLoader, type TileManifestEntry } from '../tile-loader';
import { loadFeaturesForGeoIds } from '../geo-id-resolver';
import { SOURCE_ID, ALL_LAYER_IDS, LINE_LAYERS, BG_LAYERS, addPathLayers } from './tile-path-styles';
import { setupPathInteractions } from './tile-path-interactions';
import type { MapLayer, LayerContext } from './types';

export interface TilePathLayerOptions {
  /** Pre-fetched or pre-resolved manifest entries */
  manifestPromise: Promise<TileManifestEntry[]>;
  /** Base URL for tiles, e.g. '/bike-paths/geo/tiles/' */
  fetchPath: string;
  /** Geo IDs to highlight (detail page mode) */
  highlightGeoIds?: Set<string>;
  /**
   * When true, paths are the main content (not background to routes).
   * Increases line widths, enables popups on all paths (not just hasPage),
   * and uses richer popup content from tile properties.
   */
  foreground?: boolean;
  /** Override which features are interactive (by geoId). When omitted, uses hasPage. */
  interactiveGeoIds?: Set<string>;
  /** Optional slug info for richer popups (vibe, network name, network URL). */
  slugInfo?: Record<string, { name: string; url: string; length_km?: number; surface?: string; path_type?: string; vibe?: string; network?: string; networkUrl?: string }>;
  /** Localized labels for popups. */
  labels?: { viewDetails?: string };
}

export interface FitOptions { maxZoom?: number; padding?: number }

export interface TilePathLayer extends MapLayer {
  highlightGeoIds(map: maplibregl.Map, geoIds: string[] | null, fly?: boolean, flyOpts?: FitOptions): void;
  fitToGeoIds(map: maplibregl.Map, geoIds: string[], opts?: FitOptions): Promise<boolean>;
  /** Query in-memory features by slug or network geoIds. No renderer dependency. */
  queryFeaturesBySlug(slug: string, networkGeoIds?: Record<string, string[]>): GeoJSON.Feature[];
}

/**
 * Tag tile features with highlight/interactive properties for map rendering.
 * Exported for testing — used internally by createTilePathLayer.
 */
export function tagTileFeatures(
  features: GeoJSON.Feature[],
  isDetailMode: boolean,
  highlightGeoIds?: Set<string>,
  interactiveGeoIds?: Set<string>,
): GeoJSON.Feature[] {
  for (const f of features) {
    if (!f.properties) continue;
    const geoId = f.properties._geoId;
    // Always set relationId (needed for highlight layer)
    f.properties.relationId = geoId;

    if (isDetailMode) {
      if (geoId && highlightGeoIds?.has(geoId)) {
        f.properties.highlight = 'true';
      }
      if (f.properties.hasPage) {
        f.properties.interactive = 'true';
      }
    } else if (interactiveGeoIds) {
      f.properties.interactive = interactiveGeoIds.has(geoId) ? 'true' : '';
    } else {
      if (f.properties.hasPage) {
        f.properties.interactive = 'true';
      }
    }
  }
  return features;
}

// ── Helpers ─────────────────────────────────────────────────────

function extractCoords(geom: GeoJSON.Geometry): GeoJSON.Position[] {
  if (geom.type === 'LineString') return (geom as GeoJSON.LineString).coordinates;
  if (geom.type === 'MultiLineString') return (geom as GeoJSON.MultiLineString).coordinates.flat();
  return [];
}

// ── Factory ─────────────────────────────────────────────────────

export function createTilePathLayer(opts: TilePathLayerOptions): TilePathLayer {
  const { manifestPromise, fetchPath, highlightGeoIds, foreground = false, interactiveGeoIds, slugInfo, labels } = opts;
  const isDetailMode = highlightGeoIds != null && highlightGeoIds.size > 0;

  let tileLoader: TileLoader | null = null;
  let layersCreated = false;
  let visible = true;
  let moveEndHandler: (() => void) | null = null;
  let removeInteractions: (() => void) | null = null;

  function tagFeatures(features: GeoJSON.Feature[]) {
    return tagTileFeatures(features, isDetailMode, isDetailMode ? highlightGeoIds : undefined, interactiveGeoIds);
  }

  function removeSourceAndLayers(map: maplibregl.Map) {
    const style = map.getStyle();
    if (style?.layers) {
      for (const layer of style.layers) {
        if ('source' in layer && layer.source === SOURCE_ID && map.getLayer(layer.id)) {
          map.removeLayer(layer.id);
        }
      }
    }
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
    layersCreated = false;
  }

  const layer: TilePathLayer = {
    id: 'tile-paths',
    hasContent: true,

    async setup(ctx: LayerContext) {
      const { map } = ctx;

      if (!tileLoader) {
        const manifest = await manifestPromise;
        if (!ctx.isCurrent()) return;
        tileLoader = createTileLoader(manifest, fetchPath);
      }

      const b = map.getBounds();
      const features = await tileLoader.loadTilesForBounds([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()]);
      if (!ctx.isCurrent()) return;
      tagFeatures(features);

      if (features.length === 0) return;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      });

      addPathLayers(map, isDetailMode, foreground);
      removeInteractions = setupPathInteractions(map, { foreground, slugInfo, labels });
      layersCreated = true;

      moveEndHandler = async () => {
        if (!visible || !tileLoader || !layersCreated) return;
        const prevCount = tileLoader.allLoadedFeatures().length;
        const bounds = map.getBounds();
        const newFeatures = await tileLoader.loadTilesForBounds([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
        if (newFeatures.length > prevCount) {
          tagFeatures(newFeatures);
          const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData({ type: 'FeatureCollection', features: tileLoader.allLoadedFeatures() });
          }
        }
      };
      map.on('moveend', moveEndHandler);
    },

    teardown(map: maplibregl.Map) {
      if (moveEndHandler) { map.off('moveend', moveEndHandler); moveEndHandler = null; }
      if (removeInteractions) { removeInteractions(); removeInteractions = null; }
      removeSourceAndLayers(map);
    },

    getBounds() {
      if (!tileLoader) return null;
      const features = tileLoader.allLoadedFeatures();
      const bounds = new maplibregl.LngLatBounds();
      for (const f of features) {
        if (isDetailMode && f.properties?._geoId && !highlightGeoIds!.has(f.properties._geoId)) continue;
        for (const c of extractCoords(f.geometry)) bounds.extend(c as [number, number]);
      }
      return bounds.isEmpty() ? null : bounds;
    },

    setVisible(map: maplibregl.Map, v: boolean) {
      visible = v;
      const vis = v ? 'visible' : 'none';
      for (const id of ALL_LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
    },

    highlightGeoIds(map: maplibregl.Map, geoIds: string[] | null, fly = false, flyOpts?: FitOptions) {
      if (!map.getLayer('paths-network-highlight')) return;
      if (geoIds && geoIds.length > 0) {
        map.setFilter('paths-network-highlight', ['in', ['get', 'relationId'], ['literal', geoIds]]);
        for (const id of LINE_LAYERS) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.highlight.dimInteractive);
        }
        for (const id of BG_LAYERS) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.highlight.dimOther);
        }
        if (fly) this.fitToGeoIds(map, geoIds, flyOpts);
      } else {
        map.setFilter('paths-network-highlight', ['==', ['get', 'relationId'], '']);
        for (const id of LINE_LAYERS) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.interactive.opacity);
        }
        for (const id of BG_LAYERS) {
          if (map.getLayer(id)) map.setPaintProperty(id, 'line-opacity', pathForeground.other.opacity);
        }
      }
    },

    async fitToGeoIds(map: maplibregl.Map, geoIds: string[], opts?: FitOptions) {
      if (!tileLoader) return false;
      // Load exactly the tiles that contain these geoIds, then filter
      const features = await loadFeaturesForGeoIds(tileLoader, geoIds);
      if (features.length === 0) return false;

      // Update the map source with newly loaded features
      const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
      if (source) {
        const all = tileLoader.allLoadedFeatures();
        tagFeatures(all);
        source.setData({ type: 'FeatureCollection', features: all });
      }
      let minLng = Infinity, maxLng = -Infinity, minLat = Infinity, maxLat = -Infinity;
      for (const f of features) {
        for (const [lng, lat] of extractCoords(f.geometry) as [number, number][]) {
          if (lng < minLng) minLng = lng;
          if (lng > maxLng) maxLng = lng;
          if (lat < minLat) minLat = lat;
          if (lat > maxLat) maxLat = lat;
        }
      }
      if (minLng === Infinity) return false;
      const fitOpts: maplibregl.FitBoundsOptions = { padding: opts?.padding ?? 60, animate: true, duration: 500 };
      if (opts?.maxZoom != null) fitOpts.maxZoom = opts.maxZoom;
      map.fitBounds([[minLng, minLat], [maxLng, maxLat]], fitOpts);
      return true;
    },

    queryFeaturesBySlug(slug: string, netGeoIds?: Record<string, string[]>) {
      if (!tileLoader) return [];
      const all = tileLoader.allLoadedFeatures();
      const isNetwork = netGeoIds?.[slug];
      if (isNetwork) {
        const ids = new Set(netGeoIds![slug]);
        return all.filter(f => f.properties?.relationId && ids.has(f.properties.relationId));
      }
      return all.filter(f => f.properties?.slug === slug);
    },
  };

  return layer;
}

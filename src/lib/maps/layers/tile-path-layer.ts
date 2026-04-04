// src/lib/maps/layers/tile-path-layer.ts
import maplibregl from 'maplibre-gl';
import { ROUTE_COLOR, ROUTE_LINE_WIDTH, showPopup } from '../map-init';
import { createTileLoader, type TileLoader, type TileManifestEntry } from '../tile-loader';
import type { MapLayer, LayerContext } from './types';

export interface PathInfo {
  relId: string;
  slug: string;
  name: string;
  hasPage: boolean;
  surface?: string;
  interactive?: boolean;
  memberOf?: string;
}

export interface TilePathLayerOptions {
  /** Pre-fetched or pre-resolved manifest entries */
  manifestPromise: Promise<TileManifestEntry[]>;
  /** Path metadata indexed by relation ID */
  pathInfo: Map<string, PathInfo>;
  /** Base URL for tiles, e.g. '/bike-paths/geo/tiles/' */
  fetchPath: string;
}

const SOURCE_ID = 'paths-network';

export function createTilePathLayer(opts: TilePathLayerOptions): MapLayer {
  const { manifestPromise, pathInfo, fetchPath } = opts;

  let tileLoader: TileLoader | null = null;
  let layersCreated = false;
  let visible = true;
  let moveEndHandler: (() => void) | null = null;
  let clickHandler: ((e: maplibregl.MapLayerMouseEvent) => void) | null = null;
  let enterHandler: (() => void) | null = null;
  let leaveHandler: (() => void) | null = null;

  function enrichFeatures(features: GeoJSON.Feature[]) {
    for (const f of features) {
      const geoId = f.properties?._geoId;
      if (!geoId) continue;
      const info = pathInfo.get(geoId);
      if (info) {
        f.properties!.slug = info.slug;
        f.properties!.name = info.name;
        f.properties!.surface = info.surface || '';
        f.properties!.hasPage = info.hasPage ? 'true' : '';
        f.properties!.interactive = info.interactive ? 'true' : '';
        f.properties!.memberOf = info.memberOf || '';
        f.properties!.relId = geoId;
      }
    }
    return features;
  }

  function escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
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

  function removeListeners(map: maplibregl.Map) {
    if (moveEndHandler) { map.off('moveend', moveEndHandler); moveEndHandler = null; }
    if (clickHandler && map.getLayer('paths-network-line')) {
      map.off('click', 'paths-network-line', clickHandler);
      clickHandler = null;
    }
    if (enterHandler && map.getLayer('paths-network-line')) {
      map.off('mouseenter', 'paths-network-line', enterHandler);
      enterHandler = null;
    }
    if (leaveHandler && map.getLayer('paths-network-line')) {
      map.off('mouseleave', 'paths-network-line', leaveHandler);
      leaveHandler = null;
    }
  }

  function setupLayers(map: maplibregl.Map, features: GeoJSON.Feature[]) {
    if (features.length === 0) return;

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features },
    });

    // Non-interactive paths: fade out and thin when zoomed out
    map.addLayer({
      id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
      filter: ['!=', ['get', 'interactive'], 'true'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 12, 2, 14, 4],
        'line-opacity': ['interpolate', ['linear'], ['zoom'], 8, 0.08, 12, 0.2, 14, 0.45],
      },
    });

    // Interactive paths: thinner when zoomed out, full width when zoomed in
    map.addLayer({
      id: 'paths-network-line', type: 'line', source: SOURCE_ID,
      filter: ['==', ['get', 'interactive'], 'true'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 2, 12, 4, 14, ROUTE_LINE_WIDTH],
        'line-opacity': 0.8,
      },
    });

    // Path name labels — rendered above the line so text is always readable
    map.addLayer({
      id: 'paths-network-labels', type: 'symbol', source: SOURCE_ID,
      filter: ['==', ['get', 'interactive'], 'true'],
      minzoom: 11,
      layout: {
        'symbol-placement': 'line',
        'text-field': ['get', 'name'],
        'text-size': 12,
        'text-font': ['Open Sans Regular'],
        'text-anchor': 'center',
        'text-offset': [0, -1],
        'text-max-angle': 30,
        'symbol-spacing': 300,
        'text-allow-overlap': false,
      },
      paint: {
        'text-color': ROUTE_COLOR,
        'text-halo-color': '#ffffff',
        'text-halo-width': 2,
      },
    });

    clickHandler = (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties!;
      const name = escHtml(props.name);
      const memberOf = props.memberOf ? escHtml(props.memberOf) : '';
      const pathUrl = props.slug
        ? (memberOf ? `/bike-paths/${memberOf}/${escHtml(props.slug)}` : `/bike-paths/${escHtml(props.slug)}`)
        : '';
      const nameLink = pathUrl
        ? `<a href="${pathUrl}">${name}</a>`
        : name;
      const surfaceInfo = props.surface ? `<br>${escHtml(props.surface)}` : '';
      showPopup(map, new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<div class="place-popup">${nameLink}${surfaceInfo}</div>`));
    };
    map.on('click', 'paths-network-line', clickHandler);

    enterHandler = () => { map.getCanvas().style.cursor = 'pointer'; };
    leaveHandler = () => { map.getCanvas().style.cursor = ''; };
    map.on('mouseenter', 'paths-network-line', enterHandler);
    map.on('mouseleave', 'paths-network-line', leaveHandler);

    layersCreated = true;
  }

  return {
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
      enrichFeatures(features);

      setupLayers(map, features);

      moveEndHandler = async () => {
        if (!visible || !tileLoader || !layersCreated) return;
        const prevCount = tileLoader.allLoadedFeatures().length;
        const bounds = map.getBounds();
        const newFeatures = await tileLoader.loadTilesForBounds([bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]);
        if (newFeatures.length > prevCount) {
          enrichFeatures(newFeatures);
          const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData({ type: 'FeatureCollection', features: tileLoader.allLoadedFeatures() });
          }
        }
      };
      map.on('moveend', moveEndHandler);
    },

    teardown(map: maplibregl.Map) {
      removeListeners(map);
      removeSourceAndLayers(map);
    },

    setVisible(map: maplibregl.Map, v: boolean) {
      visible = v;
      const vis = v ? 'visible' : 'none';
      if (map.getLayer('paths-network-bg')) map.setLayoutProperty('paths-network-bg', 'visibility', vis);
      if (map.getLayer('paths-network-line')) map.setLayoutProperty('paths-network-line', 'visibility', vis);
      if (map.getLayer('paths-network-labels')) map.setLayoutProperty('paths-network-labels', 'visibility', vis);
    },
  };
}

// src/lib/maps/layers/tile-path-layer.ts
import maplibregl from 'maplibre-gl';
import { ROUTE_COLOR, ROUTE_LINE_WIDTH } from '../map-init';
import { createTileLoader, type TileLoader, type TileManifestEntry } from '../tile-loader';
import type { MapLayer, LayerContext } from './types';

export interface PathInfo {
  relId: string;
  slug: string;
  name: string;
  hasPage: boolean;
  surface?: string;
  interactive?: boolean;
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

    map.addLayer({
      id: 'paths-network-bg', type: 'line', source: SOURCE_ID,
      filter: ['!=', ['get', 'interactive'], 'true'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': Math.max(1, ROUTE_LINE_WIDTH - 2),
        'line-opacity': 0.5,
      },
    });

    map.addLayer({
      id: 'paths-network-line', type: 'line', source: SOURCE_ID,
      filter: ['==', ['get', 'interactive'], 'true'],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ROUTE_COLOR,
        'line-width': ROUTE_LINE_WIDTH,
        'line-opacity': 0.8,
      },
    });

    clickHandler = (e) => {
      if (!e.features?.length) return;
      const props = e.features[0].properties!;
      const name = escHtml(props.name);
      const nameLink = props.slug
        ? `<a href="/bike-paths/${escHtml(props.slug)}">${name}</a>`
        : name;
      const surfaceInfo = props.surface ? `<br>${escHtml(props.surface)}` : '';
      new maplibregl.Popup()
        .setLngLat(e.lngLat)
        .setHTML(`<div class="place-popup">${nameLink}${surfaceInfo}</div>`)
        .addTo(map);
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
        if (!tileLoader || !layersCreated) return;
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

    setVisible(map: maplibregl.Map, visible: boolean) {
      const vis = visible ? 'visible' : 'none';
      if (map.getLayer('paths-network-bg')) map.setLayoutProperty('paths-network-bg', 'visibility', vis);
      if (map.getLayer('paths-network-line')) map.setLayoutProperty('paths-network-line', 'visibility', vis);
    },
  };
}

// src/lib/maps/layers/photo-layer.ts
import maplibregl from 'maplibre-gl';
import { buildImageUrl } from '../../media/image-service';
import { html, raw } from '../map-helpers';
import { showPopup } from '../map-init';
import { createTileLoader, type TileLoader } from '../tile-loader';
import type { MapLayer, LayerContext } from './types';

export interface PhotoLayerOptions {
  cdnUrl: string;
  defaultVisible?: boolean;
}

const SOURCE_ID = 'photo-markers';
const LAYER_IDS = ['photo-clusters', 'photo-unclustered'];
const MANIFEST_PATH = '/places/geo/photos/manifest.json';
const TILE_PATH = '/places/geo/photos/';

interface PhotoProps {
  key: string;
  caption?: string;
  width?: number;
  height?: number;
  routeName?: string;
  routeUrl?: string;
}

const preloadedUrls = new Set<string>();
function preloadImage(url: string) {
  if (preloadedUrls.has(url)) return;
  preloadedUrls.add(url);
  const img = new Image();
  img.src = url;
}

function photoPopupMaxWidth(zoom: number): number {
  const t = Math.max(0, Math.min(1, (zoom - 8) / 8));
  return Math.round(100 + 400 * t * t);
}

export function createPhotoLayer(opts: PhotoLayerOptions): MapLayer {
  const { cdnUrl, defaultVisible = true } = opts;

  let visible = defaultVisible;
  let tileLoader: TileLoader | null = null;
  let syncHandler: (() => void) | null = null;
  let zoomHandler: (() => void) | null = null;
  let moveEndHandler: (() => void) | null = null;
  const bubbleMarkers = new Map<string, maplibregl.Marker>();
  const clusterMarkers = new Map<number, maplibregl.Marker>();

  function removeAllDomMarkers(map: maplibregl.Map) {
    for (const [, m] of bubbleMarkers) m.remove();
    bubbleMarkers.clear();
    for (const [, m] of clusterMarkers) m.remove();
    clusterMarkers.clear();
    map.getContainer().querySelectorAll('.photo-bubble').forEach(el => el.remove());
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
  }

  function removeListeners(map: maplibregl.Map) {
    if (syncHandler) { map.off('idle', syncHandler); syncHandler = null; }
    if (zoomHandler) { map.off('zoom', zoomHandler); zoomHandler = null; }
    if (moveEndHandler) { map.off('moveend', moveEndHandler); moveEndHandler = null; }
  }

  /**
   * Spread overlapping bubble markers apart in screen space.
   * Groups markers whose projected positions are within `threshold` px,
   * then arranges each group in a circle around the centroid.
   */
  function spreadOverlaps(map: maplibregl.Map) {
    const threshold = 24; // px — less than bubble radius, so only truly overlapping
    const entries: Array<{ key: string; marker: maplibregl.Marker; x: number; y: number }> = [];

    for (const [key, marker] of bubbleMarkers) {
      const pt = map.project(marker.getLngLat());
      entries.push({ key, marker, x: pt.x, y: pt.y });
    }

    // Reset all offsets first
    for (const e of entries) e.marker.setOffset([0, 0]);

    if (entries.length < 2) return;

    // Group overlapping markers (simple single-pass clustering)
    const assigned = new Set<string>();
    const groups: typeof entries[] = [];

    for (const a of entries) {
      if (assigned.has(a.key)) continue;
      const group = [a];
      assigned.add(a.key);
      for (const b of entries) {
        if (assigned.has(b.key)) continue;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        if (dx * dx + dy * dy < threshold * threshold) {
          group.push(b);
          assigned.add(b.key);
        }
      }
      if (group.length > 1) groups.push(group);
    }

    // Spread each overlapping group in a circle
    for (const group of groups) {
      const radius = Math.max(20, group.length * 8); // px, scales with group size
      for (let i = 0; i < group.length; i++) {
        const angle = (2 * Math.PI * i) / group.length - Math.PI / 2;
        const dx = Math.round(radius * Math.cos(angle));
        const dy = Math.round(radius * Math.sin(angle));
        group[i].marker.setOffset([dx, dy]);
      }
    }
  }

  function showPhotoPopup(map: maplibregl.Map, props: PhotoProps, coords: [number, number]) {
    const imgUrl = buildImageUrl(cdnUrl, props.key, { width: 800, fit: 'scale-down' });
    const fullUrl = buildImageUrl(cdnUrl, props.key, { width: 1600 });
    const routeLink = props.routeName && props.routeUrl
      ? html`<p class="photo-popup-route"><a href="${raw(props.routeUrl)}">${props.routeName}</a></p>` : '';
    const captionBlock = props.caption ? html`<p class="photo-popup-caption">${props.caption}</p>` : '';
    const imgWidth = 800;
    const imgHeight = props.width && props.height ? Math.round(imgWidth * props.height / props.width) : undefined;
    const sizeAttrs = imgHeight ? ` width="${imgWidth}" height="${imgHeight}"` : '';

    const popupHtml = html`
      <div class="photo-popup-content">
        <a href="${raw(fullUrl)}" target="_blank">
          <img src="${raw(imgUrl)}" alt="${props.caption || 'Photo'}"${raw(sizeAttrs)} />
        </a>
        ${raw(captionBlock)}
        ${raw(routeLink)}
      </div>
    `;

    const popup = new maplibregl.Popup({ maxWidth: `${photoPopupMaxWidth(map.getZoom())}px` })
      .setLngLat(coords)
      .setHTML(popupHtml);
    showPopup(map, popup);

    const onZoom = () => popup.setMaxWidth(`${photoPopupMaxWidth(map.getZoom())}px`);
    map.on('zoom', onZoom);
    popup.on('close', () => map.off('zoom', onZoom));
  }

  return {
    id: 'photos',
    hasContent: true,

    async setup(ctx: LayerContext) {
      const { map } = ctx;

      // Lazy-init tile loader
      if (!tileLoader) {
        const res = await fetch(MANIFEST_PATH);
        if (!res.ok) return;
        const manifest = await res.json();
        if (!ctx.isCurrent()) return;
        tileLoader = createTileLoader(manifest, TILE_PATH);
      }

      // Load tiles for current viewport
      const b = map.getBounds();
      const features = await tileLoader.loadTilesForBounds([
        b.getWest(), b.getSouth(), b.getEast(), b.getNorth(),
      ]);
      if (!ctx.isCurrent()) return;

      if (features.length === 0) return;

      const minZoom = features.length > 200 ? 11 : features.length > 50 ? 8 : 0;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
        cluster: true,
        clusterRadius: 80,
        clusterMaxZoom: 15,
      });

      map.addLayer({
        id: 'photo-clusters', type: 'circle', source: SOURCE_ID,
        filter: ['has', 'point_count'], minzoom: minZoom,
        paint: { 'circle-radius': 1, 'circle-opacity': 0 },
      });

      map.addLayer({
        id: 'photo-unclustered', type: 'circle', source: SOURCE_ID,
        filter: ['!', ['has', 'point_count']], minzoom: minZoom,
        paint: { 'circle-radius': 1, 'circle-opacity': 0 },
      });

      // Load new tiles on pan/zoom
      moveEndHandler = async () => {
        if (!visible || !tileLoader) return;
        const prevCount = tileLoader.allLoadedFeatures().length;
        const bounds = map.getBounds();
        const newFeatures = await tileLoader.loadTilesForBounds([
          bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth(),
        ]);
        if (newFeatures.length > prevCount) {
          const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
          if (source) {
            source.setData({ type: 'FeatureCollection', features: newFeatures });
          }
        }
      };
      map.on('moveend', moveEndHandler);

      // DOM bubble sync on idle — guarded against concurrent runs.
      // The handler is async (awaits getClusterLeaves). If a second idle fires
      // while the first is suspended at an await, the second run could clean up
      // markers that the first run then recreates as zombies.
      let syncing = false;
      syncHandler = async () => {
        if (!visible) return;
        if (syncing) { map.triggerRepaint(); return; }
        syncing = true;
        try {
        const source = map.getSource(SOURCE_ID) as maplibregl.GeoJSONSource | undefined;
        if (!source) return;

        // Individual photos
        const unclustered = map.queryRenderedFeatures({ layers: ['photo-unclustered'] });
        const seenKeys = new Set<string>();
        for (const f of unclustered) {
          const key = f.properties!.key as string;
          if (seenKeys.has(key)) continue;
          seenKeys.add(key);

          if (!bubbleMarkers.has(key)) {
            const props = f.properties!;
            const coords = (f.geometry as GeoJSON.Point).coordinates as [number, number];
            const thumbUrl = buildImageUrl(cdnUrl, props.key, { width: 80, height: 80, fit: 'cover' });
            const el = document.createElement('div');
            el.className = 'photo-bubble';
            el.innerHTML = `<img src="${thumbUrl}" alt="" loading="lazy" />`;
            el.addEventListener('mouseenter', () => {
              if (!visible) return;
              preloadImage(buildImageUrl(cdnUrl, props.key, { width: 1000, fit: 'scale-down' }));
            });
            el.addEventListener('click', (e) => {
              e.stopPropagation();
              showPhotoPopup(map, props as unknown as PhotoProps, coords);
            });
            const marker = new maplibregl.Marker({ element: el }).setLngLat(coords).addTo(map);
            bubbleMarkers.set(key, marker);
          }
        }

        if (visible) {
          for (const key of seenKeys) {
            preloadImage(buildImageUrl(cdnUrl, key, { width: 1000, fit: 'scale-down' }));
          }
        }

        for (const [key, marker] of bubbleMarkers) {
          if (!seenKeys.has(key)) { marker.remove(); bubbleMarkers.delete(key); }
        }

        // Spread overlapping bubbles apart
        spreadOverlaps(map);

        // Cluster thumbnails
        const clusters = map.queryRenderedFeatures({ layers: ['photo-clusters'] });
        const seenClusterIds = new Set<number>();
        for (const f of clusters) {
          const clusterId = f.properties?.cluster_id as number;
          if (seenClusterIds.has(clusterId)) continue;
          seenClusterIds.add(clusterId);

          try {
            const count = f.properties?.point_count as number;
            const allLeaves = await source.getClusterLeaves(clusterId, count, 0);
            if (allLeaves.length > 0 && allLeaves.every(l => seenKeys.has(l.properties?.key as string))) {
              clusterMarkers.get(clusterId)?.remove();
              clusterMarkers.delete(clusterId);
              continue;
            }
          } catch {
            // Cluster no longer exists (zoom broke it apart) — remove stale marker
            clusterMarkers.get(clusterId)?.remove();
            clusterMarkers.delete(clusterId);
            continue;
          }

          if (!clusterMarkers.has(clusterId)) {
            const count = f.properties?.point_count as number;
            try {
              const leaves = await source.getClusterLeaves(clusterId, 1, 0);
              const leaf = leaves[0];
              const leafKey = leaf?.properties?.key as string | undefined;
              if (!leafKey || !leaf) continue;
              // Position cluster at cover photo, not centroid
              const coverCoords = (leaf.geometry as GeoJSON.Point).coordinates as [number, number];
              const thumbUrl = buildImageUrl(cdnUrl, leafKey, { width: 80, height: 80, fit: 'cover' });
              const el = document.createElement('div');
              el.className = 'photo-bubble photo-bubble--cluster';
              el.innerHTML = `<img src="${thumbUrl}" alt="" loading="lazy" /><span class="photo-bubble--count">${count}</span>`;
              el.addEventListener('click', (e) => {
                e.stopPropagation();
                // Zoom to cover photo location
                map.flyTo({ center: coverCoords, zoom: 16, duration: 600 });
              });
              const marker = new maplibregl.Marker({ element: el }).setLngLat(coverCoords).addTo(map);
              clusterMarkers.set(clusterId, marker);
            } catch { /* cluster removed between query and fetch */ }
          }
        }

        for (const [id, marker] of clusterMarkers) {
          if (!seenClusterIds.has(id)) { marker.remove(); clusterMarkers.delete(id); }
        }
        } finally { syncing = false; }
      };
      map.on('idle', syncHandler);

      // Resize bubbles on zoom
      zoomHandler = () => {
        const bubbleSize = Math.round(Math.min(48, Math.max(30, (map.getZoom() - 11) * 4.5 + 30)));
        for (const [, marker] of bubbleMarkers) {
          const el = marker.getElement().querySelector('.photo-bubble') || marker.getElement();
          (el as HTMLElement).style.width = `${bubbleSize}px`;
          (el as HTMLElement).style.height = `${bubbleSize}px`;
        }
        const clusterSize = Math.round(Math.min(52, Math.max(34, (map.getZoom() - 8) * 3 + 34)));
        for (const [, marker] of clusterMarkers) {
          const el = marker.getElement().querySelector('.photo-bubble') || marker.getElement();
          (el as HTMLElement).style.width = `${clusterSize}px`;
          (el as HTMLElement).style.height = `${clusterSize}px`;
        }
        spreadOverlaps(map);
      };
      map.on('zoom', zoomHandler);

      if (!visible) this.setVisible!(map, false);
    },

    teardown(map: maplibregl.Map) {
      removeListeners(map);
      removeAllDomMarkers(map);
      removeSourceAndLayers(map);
    },

    setVisible(map: maplibregl.Map, v: boolean) {
      visible = v;
      const vis = v ? 'visible' : 'none';
      for (const id of LAYER_IDS) {
        if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', vis);
      }
      const bubbles = map.getContainer().querySelectorAll('.photo-bubble');
      for (const el of bubbles) {
        (el as HTMLElement).style.display = v ? '' : 'none';
      }
      // When turning on, trigger repaint so the idle sync handler runs
      // and creates any bubbles that were skipped while invisible.
      if (v) map.triggerRepaint();
    },
  };
}

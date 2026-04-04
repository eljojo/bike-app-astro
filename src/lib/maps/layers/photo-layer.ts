// src/lib/maps/layers/photo-layer.ts
import maplibregl from 'maplibre-gl';
import { buildImageUrl } from '../../media/image-service';
import { html, raw } from '../map-helpers';
import { showPopup } from '../map-init';
import type { MapLayer, LayerContext } from './types';
import type { PhotoMarkerOptions } from '../map-init';

export interface PhotoLayerOptions {
  photos: PhotoMarkerOptions[];
  cdnUrl: string;
  defaultVisible?: boolean;
}

const SOURCE_ID = 'photo-markers';
const LAYER_IDS = ['photo-clusters', 'photo-unclustered'];

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
  const { photos, cdnUrl, defaultVisible = true } = opts;

  let visible = defaultVisible;
  let syncHandler: (() => void) | null = null;
  let zoomHandler: (() => void) | null = null;
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
  }

  function showPhotoPopup(map: maplibregl.Map, props: PhotoMarkerOptions, coords: [number, number]) {
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
    hasContent: photos.length > 0,

    setup(ctx: LayerContext) {
      const { map } = ctx;

      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: {
          type: 'FeatureCollection',
          features: photos.map(p => ({
            type: 'Feature' as const,
            geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] },
            properties: {
              key: p.key, caption: p.caption || '', index: p.index,
              routeName: p.routeName || '', routeUrl: p.routeUrl || '',
              width: p.width || 0, height: p.height || 0,
            },
          })),
        },
        cluster: true,
        clusterRadius: 80,
        clusterMaxZoom: 15,
      });

      const minZoom = photos.length > 200 ? 11 : photos.length > 50 ? 8 : 0;

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

      // DOM bubble sync on idle
      syncHandler = async () => {
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
              showPhotoPopup(map, props as unknown as PhotoMarkerOptions, coords);
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
          } catch { continue; }

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
    },
  };
}

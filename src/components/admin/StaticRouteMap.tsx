import { useRef, useEffect } from 'preact/hooks';
import { getStyleUrl, loadStylePreference } from '../../lib/map-style-switch';
import { ROUTE_COLOR } from '../../lib/map-init';

interface Props {
  /** Array of [lon, lat] coordinate pairs */
  coordinates: [number, number][];
  class?: string;
}

/** Non-interactive map preview showing a route polyline. */
export default function StaticRouteMap({ coordinates, class: className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<import('maplibre-gl').Map | null>(null);

  useEffect(() => {
    if (!coordinates.length || !containerRef.current) return;
    if (mapRef.current) {
      mapRef.current.remove();
      mapRef.current = null;
    }

    import('maplibre-gl').then((maplibregl) => {
      if (!containerRef.current) return;

      const sw: [number, number] = [Infinity, Infinity];
      const ne: [number, number] = [-Infinity, -Infinity];
      for (const c of coordinates) {
        if (c[0] < sw[0]) sw[0] = c[0];
        if (c[1] < sw[1]) sw[1] = c[1];
        if (c[0] > ne[0]) ne[0] = c[0];
        if (c[1] > ne[1]) ne[1] = c[1];
      }

      const map = new maplibregl.Map({
        container: containerRef.current,
        style: getStyleUrl(loadStylePreference()),
        bounds: [sw, ne],
        fitBoundsOptions: { padding: 30 },
        interactive: false,
        attributionControl: false,
        // TODO: deduplicate — this duplicates transformRequest from initMap() in map-init.ts
        // Can't use initMap directly because this map needs bounds/interactive/attribution options it doesn't support
        transformRequest: (url: string) => {
          if (url.startsWith('/')) return { url: `${location.origin}${url}` };
          return { url };
        },
      });

      map.on('load', () => {
        map.addSource('route', {
          type: 'geojson',
          data: {
            type: 'Feature',
            properties: {},
            geometry: { type: 'LineString', coordinates },
          },
        });
        map.addLayer({
          id: 'route-line',
          type: 'line',
          source: 'route',
          paint: {
            'line-color': ROUTE_COLOR,
            'line-width': 4,
            'line-opacity': 0.9,
          },
        });
      });

      mapRef.current = map;
    });

    return () => {
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, [coordinates]);

  return <div ref={containerRef} class={className} />;
}

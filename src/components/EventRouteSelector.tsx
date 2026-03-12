import { useState } from 'preact/hooks';

interface RouteInfo {
  slug: string;
  name: string;
  distance_km: number;
  elevation_m: number;
  color: string;
  url: string;
}

interface Props {
  routes: RouteInfo[];
}

export default function EventRouteSelector({ routes }: Props) {
  const [visible, setVisible] = useState<Set<string>>(() => new Set(routes.map(r => r.slug)));

  function toggle(slug: string) {
    setVisible(prev => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
      }
      window.dispatchEvent(new CustomEvent('route:toggle', {
        detail: { slug, visible: next.has(slug) },
      }));
      return next;
    });
  }

  if (routes.length <= 1) {
    const r = routes[0];
    if (!r) return null;
    return (
      <p class="event-route-single">
        <a href={r.url}>{r.name}</a>
        {' — '}{r.distance_km} km, {r.elevation_m}m+
      </p>
    );
  }

  return (
    <div class="event-route-selector">
      {routes.map(r => (
        <label key={r.slug} class="event-route-selector-item">
          <input
            type="checkbox"
            checked={visible.has(r.slug)}
            onChange={() => toggle(r.slug)}
          />
          <span class="event-route-selector-swatch" style={`background: ${r.color}`} />
          <span class="event-route-selector-name">{r.name}</span>
          <span class="event-route-selector-meta">{r.distance_km} km, {r.elevation_m}m+</span>
          <a href={r.url} class="event-route-selector-link" onClick={e => e.stopPropagation()}>→</a>
        </label>
      ))}
    </div>
  );
}

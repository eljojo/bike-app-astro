import { useState, useMemo } from 'preact/hooks';
import type { AdminMediaItem } from '../../lib/models/route-model';

interface PhotoLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
}

interface Props {
  nearbyPhotos: PhotoLocation[];
  currentMediaKeys: Set<string>;
  cdnUrl: string;
  onAddPhoto: (photo: AdminMediaItem) => void;
}

export default function NearbyPhotos({ nearbyPhotos, currentMediaKeys, cdnUrl, onAddPhoto }: Props) {
  const [collapsed, setCollapsed] = useState(true);

  const available = useMemo(
    () => nearbyPhotos.filter(p => !currentMediaKeys.has(p.key)),
    [nearbyPhotos, currentMediaKeys],
  );

  if (available.length === 0) return null;

  // Group by source route
  const byRoute = new Map<string, PhotoLocation[]>();
  for (const p of available) {
    const list = byRoute.get(p.routeSlug) || [];
    list.push(p);
    byRoute.set(p.routeSlug, list);
  }

  return (
    <div class={`nearby-photos${collapsed ? '' : ' nearby-photos--open'}`}>
      <button
        type="button"
        class="nearby-photos-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        Nearby Photos ({available.length})
        {collapsed ? ' \u25b8' : ' \u25be'}
      </button>

      {!collapsed && (
        <div class="nearby-photos-list">
          {Array.from(byRoute.entries()).map(([slug, photos]) => (
            <div key={slug} class="nearby-route-group">
              <h4>{slug}</h4>
              <div class="nearby-photos-grid">
                {photos.map(photo => (
                  <div key={photo.key} class="nearby-photo-card">
                    <img
                      src={`${cdnUrl}/cdn-cgi/image/width=120,height=120,fit=cover/${photo.key}`}
                      alt={photo.caption || ''}
                      loading="lazy"
                    />
                    {photo.caption && <span class="caption">{photo.caption}</span>}
                    <button
                      type="button"
                      class="add-btn"
                      title="Add to this route"
                      onClick={() => onAddPhoto({
                        key: photo.key,
                        lat: photo.lat,
                        lng: photo.lng,
                        width: photo.width,
                        height: photo.height,
                      })}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

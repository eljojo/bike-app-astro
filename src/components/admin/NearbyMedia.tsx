import { useState, useMemo } from 'preact/hooks';
import type { AdminMediaItem } from '../../lib/models/route-model';
import type { ParkedMediaEntry } from '../../lib/media/media-merge';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';

interface MediaLocation {
  key: string;
  lat: number;
  lng: number;
  routeSlug: string;
  caption?: string;
  width?: number;
  height?: number;
}

interface Props {
  nearbyMedia: MediaLocation[];
  parkedMedia: ParkedMediaEntry[];
  currentMediaKeys: Set<string>;
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  userRole?: string;
  onAddMedia: (item: AdminMediaItem, wasParked: boolean) => void;
  onParkMedia: (item: AdminMediaItem) => void;
  onDeleteParked?: (key: string) => void;
  initiallyExpanded?: boolean;
}

export default function NearbyMedia({ nearbyMedia, parkedMedia, currentMediaKeys, cdnUrl, videosCdnUrl, videoPrefix, userRole, onAddMedia, onParkMedia, onDeleteParked, initiallyExpanded }: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };
  const [collapsed, setCollapsed] = useState(!initiallyExpanded);
  const [dragOverPanel, setDragOverPanel] = useState(false);

  const available = useMemo(
    () => nearbyMedia.filter(p => !currentMediaKeys.has(p.key)),
    [nearbyMedia, currentMediaKeys],
  );

  const availableParked = useMemo(
    () => parkedMedia.filter(p => !currentMediaKeys.has(p.key)),
    [parkedMedia, currentMediaKeys],
  );

  const totalCount = available.length + availableParked.length;
  if (totalCount === 0 && !dragOverPanel) return null;

  // Group nearby media by source route
  const byRoute = new Map<string, MediaLocation[]>();
  for (const p of available) {
    if (p.routeSlug === '__parked') continue; // parked shown separately
    const list = byRoute.get(p.routeSlug) || [];
    list.push(p);
    byRoute.set(p.routeSlug, list);
  }

  function handleSuggestionDragStart(e: DragEvent, item: MediaLocation | ParkedMediaEntry, isParked: boolean) {
    e.dataTransfer!.setData('text/photo-key', item.key);
    e.dataTransfer!.setData('text/suggestion-data', JSON.stringify({ ...item, wasParked: isParked }));
    e.dataTransfer!.effectAllowed = 'move';
  }

  function handlePanelDragOver(e: DragEvent) {
    // Only accept drops from media grid (has photo-data, not suggestion-data)
    if (e.dataTransfer?.types.includes('text/photo-data')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverPanel(true);
    }
  }

  function handlePanelDragLeave(e: DragEvent) {
    const target = e.currentTarget as HTMLElement;
    const related = e.relatedTarget as Node | null;
    if (!related || !target.contains(related)) {
      setDragOverPanel(false);
    }
  }

  function handlePanelDrop(e: DragEvent) {
    e.preventDefault();
    setDragOverPanel(false);
    const photoData = e.dataTransfer?.getData('text/photo-data');
    if (photoData) {
      const item = JSON.parse(photoData) as AdminMediaItem;
      onParkMedia(item);
    }
  }

  return (
    <div
      class={`nearby-media${collapsed ? '' : ' nearby-media--open'}${dragOverPanel ? ' nearby-media--drop-target' : ''}`}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      <button
        type="button"
        class="nearby-media-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        {dragOverPanel ? 'Drop here to park' : `Nearby Photos (${totalCount})`}
        {!dragOverPanel && (collapsed ? ' \u25b8' : ' \u25be')}
      </button>

      {!collapsed && (
        <div class="nearby-media-list">
          {Array.from(byRoute.entries()).map(([slug, items]) => (
            <div key={slug} class="nearby-route-group">
              <h4>{slug}</h4>
              <div class="nearby-media-grid">
                {items.map(item => (
                  <div
                    key={item.key}
                    class="nearby-media-card"
                    draggable
                    onDragStart={(e: DragEvent) => handleSuggestionDragStart(e, item, false)}
                  >
                    <img
                      src={buildMediaThumbnailUrl(item, thumbConfig, { width: 120, height: 120, fit: 'cover' })}
                      alt={item.caption || ''}
                      loading="lazy"
                    />
                    {item.caption && <span class="caption">{item.caption}</span>}
                    <button
                      type="button"
                      class="add-btn"
                      title="Add to this route"
                      onClick={() => onAddMedia(item, false)}
                    >
                      +
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {availableParked.length > 0 && (
            <div class="nearby-route-group">
              <h4>Parked</h4>
              <div class="nearby-media-grid">
                {availableParked.map(item => (
                  <div
                    key={item.key}
                    class="nearby-media-card"
                    draggable
                    onDragStart={(e: DragEvent) => handleSuggestionDragStart(e, item, true)}
                  >
                    <img
                      src={buildMediaThumbnailUrl(item, thumbConfig, { width: 120, height: 120, fit: 'cover' })}
                      alt={item.caption || ''}
                      loading="lazy"
                    />
                    <span class="parked-badge">parked</span>
                    {item.caption && <span class="caption">{item.caption}</span>}
                    <button
                      type="button"
                      class="add-btn"
                      title="Add to this route"
                      onClick={() => onAddMedia(item, true)}
                    >
                      +
                    </button>
                    {userRole === 'admin' && onDeleteParked && (
                      <button
                        type="button"
                        class="delete-parked-btn"
                        title="Remove permanently"
                        onClick={() => onDeleteParked(item.key)}
                      >
                        &times;
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

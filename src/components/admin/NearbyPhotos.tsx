import { useState, useMemo } from 'preact/hooks';
import type { AdminMediaItem } from '../../lib/models/route-model';
import type { ParkedPhotoEntry } from '../../lib/media-merge';

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
  parkedPhotos: ParkedPhotoEntry[];
  currentMediaKeys: Set<string>;
  cdnUrl: string;
  userRole?: string;
  onAddPhoto: (photo: AdminMediaItem, wasParked: boolean) => void;
  onParkPhoto: (photo: AdminMediaItem) => void;
  onDeleteParked?: (key: string) => void;
  initiallyExpanded?: boolean;
}

export default function NearbyPhotos({ nearbyPhotos, parkedPhotos, currentMediaKeys, cdnUrl, userRole, onAddPhoto, onParkPhoto, onDeleteParked, initiallyExpanded }: Props) {
  const [collapsed, setCollapsed] = useState(!initiallyExpanded);
  const [dragOverPanel, setDragOverPanel] = useState(false);

  const available = useMemo(
    () => nearbyPhotos.filter(p => !currentMediaKeys.has(p.key)),
    [nearbyPhotos, currentMediaKeys],
  );

  const availableParked = useMemo(
    () => parkedPhotos.filter(p => !currentMediaKeys.has(p.key)),
    [parkedPhotos, currentMediaKeys],
  );

  const totalCount = available.length + availableParked.length;
  if (totalCount === 0 && !dragOverPanel) return null;

  // Group nearby photos by source route
  const byRoute = new Map<string, PhotoLocation[]>();
  for (const p of available) {
    if (p.routeSlug === '__parked') continue; // parked shown separately
    const list = byRoute.get(p.routeSlug) || [];
    list.push(p);
    byRoute.set(p.routeSlug, list);
  }

  function handleSuggestionDragStart(e: DragEvent, photo: PhotoLocation | ParkedPhotoEntry, isParked: boolean) {
    e.dataTransfer!.setData('text/photo-key', photo.key);
    e.dataTransfer!.setData('text/suggestion-data', JSON.stringify({ ...photo, wasParked: isParked }));
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
      const photo = JSON.parse(photoData) as AdminMediaItem;
      onParkPhoto(photo);
    }
  }

  return (
    <div
      class={`nearby-photos${collapsed ? '' : ' nearby-photos--open'}${dragOverPanel ? ' nearby-photos--drop-target' : ''}`}
      onDragOver={handlePanelDragOver}
      onDragLeave={handlePanelDragLeave}
      onDrop={handlePanelDrop}
    >
      <button
        type="button"
        class="nearby-photos-toggle"
        onClick={() => setCollapsed(!collapsed)}
      >
        {dragOverPanel ? 'Drop here to park photo' : `Nearby Photos (${totalCount})`}
        {!dragOverPanel && (collapsed ? ' \u25b8' : ' \u25be')}
      </button>

      {!collapsed && (
        <div class="nearby-photos-list">
          {Array.from(byRoute.entries()).map(([slug, photos]) => (
            <div key={slug} class="nearby-route-group">
              <h4>{slug}</h4>
              <div class="nearby-photos-grid">
                {photos.map(photo => (
                  <div
                    key={photo.key}
                    class="nearby-photo-card"
                    draggable
                    onDragStart={(e: DragEvent) => handleSuggestionDragStart(e, photo, false)}
                  >
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
                      onClick={() => onAddPhoto(photo, false)}
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
              <div class="nearby-photos-grid">
                {availableParked.map(photo => (
                  <div
                    key={photo.key}
                    class="nearby-photo-card"
                    draggable
                    onDragStart={(e: DragEvent) => handleSuggestionDragStart(e, photo, true)}
                  >
                    <img
                      src={`${cdnUrl}/cdn-cgi/image/width=120,height=120,fit=cover/${photo.key}`}
                      alt={photo.caption || ''}
                      loading="lazy"
                    />
                    <span class="parked-badge">parked</span>
                    {photo.caption && <span class="caption">{photo.caption}</span>}
                    <button
                      type="button"
                      class="add-btn"
                      title="Add to this route"
                      onClick={() => onAddPhoto(photo, true)}
                    >
                      +
                    </button>
                    {userRole === 'admin' && onDeleteParked && (
                      <button
                        type="button"
                        class="delete-parked-btn"
                        title="Remove permanently"
                        onClick={() => onDeleteParked(photo.key)}
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

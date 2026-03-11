import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import type { MediaItem } from './MediaManager';

interface Props {
  name: string;
  body: string;
  media: MediaItem[];
  cdnUrl: string;
  rideDate?: string;
  country?: string;
  distanceKm?: number;
  elevationM?: number;
  movingTimeS?: number;
  averageSpeedKmh?: number;
  mapThumbnail?: string;
}

function formatTime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h${m.toString().padStart(2, '0')}m`;
}

export default function RidePreview({
  name, body, media, cdnUrl, rideDate, country,
  distanceKm, elevationM, movingTimeS, averageSpeedKmh, mapThumbnail,
}: Props) {
  const renderedBody = useMemo(() => {
    if (!body) return '';
    try {
      return marked.parse(body, { async: false }) as string;
    } catch {
      return '<p>Preview unavailable</p>';
    }
  }, [body]);

  const cover = media.find(m => m.cover) || media[0];
  const photos = media;

  function imageUrl(key: string, opts?: { width?: number }) {
    const w = opts?.width || 400;
    return `${cdnUrl}/cdn-cgi/image/width=${w},format=auto/${key}`;
  }

  return (
    <div class="ride-preview">
      <div class="ride-preview-content">
        {cover && (
          <div class="ride-preview-hero">
            <img src={imageUrl(cover.key, { width: 800 })} alt={name} />
          </div>
        )}

        <h1 class="ride-preview-title">{name || 'Untitled Ride'}</h1>

        <div class="ride-preview-stats">
          {rideDate && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">Date</span>
              <span class="ride-preview-stat-value">{rideDate}</span>
            </div>
          )}
          {distanceKm != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">Distance</span>
              <span class="ride-preview-stat-value">{distanceKm.toFixed(0)} km</span>
            </div>
          )}
          {elevationM != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">Elevation</span>
              <span class="ride-preview-stat-value">{elevationM} m</span>
            </div>
          )}
          {movingTimeS != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">Moving time</span>
              <span class="ride-preview-stat-value">{formatTime(movingTimeS)}</span>
            </div>
          )}
          {averageSpeedKmh != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">Speed</span>
              <span class="ride-preview-stat-value">{averageSpeedKmh.toFixed(1)} km/h</span>
            </div>
          )}
          {country && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">Country</span>
              <span class="ride-preview-stat-value">{country}</span>
            </div>
          )}
        </div>

        {renderedBody && (
          <div class="ride-preview-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
        )}

        {mapThumbnail && (
          <div class="ride-preview-map">
            <img src={mapThumbnail} alt={`Map of ${name}`} />
          </div>
        )}

        {photos.length > 0 && (
          <div class="ride-preview-gallery">
            {photos.map((photo) => (
              <img key={photo.key} src={imageUrl(photo.key, { width: 200 })} alt={photo.caption || ''} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

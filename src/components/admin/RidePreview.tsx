import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { formatDuration } from '../../lib/date-utils';
import { formatDistance, formatSpeed } from '../../lib/format';
import type { MediaItem } from './MediaManager';
import StaticRouteMap from './StaticRouteMap';
import InteractiveElevation from '../InteractiveElevation';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import type { ElevationPoint } from '../../lib/geo/elevation-profile';

interface Props {
  name: string;
  body: string;
  media: MediaItem[];
  cdnUrl: string;
  videosCdnUrl?: string;
  videoPrefix?: string;
  rideDate?: string;
  country?: string;
  distanceKm?: number;
  elevationM?: number;
  movingTimeS?: number;
  averageSpeedKmh?: number;
  mapThumbnail?: string;
  labels?: Record<string, string>;
  coordinates?: [number, number][];
  elevationPoints?: ElevationPoint[];
}

export default function RidePreview({
  name, body, media, cdnUrl, videosCdnUrl, videoPrefix, rideDate, country,
  distanceKm, elevationM, movingTimeS, averageSpeedKmh, mapThumbnail, labels,
  coordinates, elevationPoints,
}: Props) {
  const thumbConfig: MediaThumbnailConfig = { cdnUrl, videosCdnUrl, videoPrefix };
  const renderedBody = useMemo(() => {
    if (!body) return '';
    try {
      return marked.parse(body, { async: false }) as string;
    } catch {
      return '<p>Preview unavailable</p>';
    }
  }, [body]);

  const cover = media.find(m => m.cover) || media[0];

  function thumbUrl(item: { key: string; type?: string }, opts?: { width?: number }) {
    const w = opts?.width || 400;
    return buildMediaThumbnailUrl(item, thumbConfig, { width: w, format: 'auto' });
  }

  return (
    <div class="ride-preview">
      <div class="ride-preview-content">
        {cover && (
          <div class="ride-preview-hero">
            <img
              src={thumbUrl(cover, { width: 830 })}
              srcset={`${thumbUrl(cover, { width: 1660 })} 2x`}
              alt={name}
            />
          </div>
        )}

        <h1 class="ride-preview-title">{name || 'Untitled Ride'}</h1>

        <div class="ride-preview-stats">
          {rideDate && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">{labels?.date || 'Date'}</span>
              <span class="ride-preview-stat-value">{rideDate}</span>
            </div>
          )}
          {distanceKm != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">{labels?.distance || 'Distance'}</span>
              <span class="ride-preview-stat-value">{formatDistance(distanceKm)}</span>
            </div>
          )}
          {elevationM != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">{labels?.elevation || 'Elevation'}</span>
              <span class="ride-preview-stat-value">{elevationM} m</span>
            </div>
          )}
          {movingTimeS != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">{labels?.moving_time || 'Moving time'}</span>
              <span class="ride-preview-stat-value">{formatDuration(movingTimeS)}</span>
            </div>
          )}
          {averageSpeedKmh != null && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">{labels?.speed || 'Speed'}</span>
              <span class="ride-preview-stat-value">{formatSpeed(averageSpeedKmh)}</span>
            </div>
          )}
          {country && (
            <div class="ride-preview-stat">
              <span class="ride-preview-stat-label">{labels?.country || 'Country'}</span>
              <span class="ride-preview-stat-value">{country}</span>
            </div>
          )}
        </div>

        {renderedBody && (
          <div class="ride-preview-body" dangerouslySetInnerHTML={{ __html: renderedBody }} />
        )}

        {coordinates && coordinates.length > 1 ? (
          <StaticRouteMap coordinates={coordinates} class="ride-preview-map" />
        ) : mapThumbnail ? (
          <div class="ride-preview-map">
            <img src={mapThumbnail} alt={`Map of ${name}`} />
          </div>
        ) : null}

        {elevationPoints && elevationPoints.length > 0 && (
          <InteractiveElevation points={elevationPoints} />
        )}

        {media.length > 0 && (
          <div class="ride-preview-gallery">
            {media.map((item) => (
              <div key={item.key} class="preview-gallery-item">
                <img src={thumbUrl(item, { width: 200 })} alt={item.caption || ''} />
                {item.type === 'video' && <span class="preview-gallery-play">&#x25B6;</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

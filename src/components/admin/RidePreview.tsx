import { useMemo } from 'preact/hooks';
import { marked } from 'marked';
import { formatDuration } from '../../lib/date-utils';
import { formatDistance, formatSpeed } from '../../lib/format';
import type { MediaItem } from './MediaManager';
import StaticRouteMap from './StaticRouteMap';
import { CHART } from '../../lib/geo/elevation-profile';
import { buildMediaThumbnailUrl } from '../../lib/media/image-service';
import type { MediaThumbnailConfig } from '../../lib/media/image-service';
import type { ElevationProfileData } from '../../lib/geo/elevation-profile';

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
  elevation?: ElevationProfileData | null;
}

export default function RidePreview({
  name, body, media, cdnUrl, videosCdnUrl, videoPrefix, rideDate, country,
  distanceKm, elevationM, movingTimeS, averageSpeedKmh, mapThumbnail, labels,
  coordinates, elevation,
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
  const photos = media;

  function rideImageUrl(item: { key: string; type?: string }, opts?: { width?: number }) {
    const w = opts?.width || 400;
    return buildMediaThumbnailUrl(item, thumbConfig, { width: w, format: 'auto' });
  }

  return (
    <div class="ride-preview">
      <div class="ride-preview-content">
        {cover && (
          <div class="ride-preview-hero">
            <img
              src={rideImageUrl(cover, { width: 830 })}
              srcset={`${rideImageUrl(cover, { width: 1660 })} 2x`}
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

        {elevation && (() => {
          const plotBottom = CHART.height - CHART.bottom;
          const plotLeft = CHART.left;
          const plotRight = CHART.width - CHART.right;
          return (
            <div class="ride-preview-elevation">
              <svg viewBox={`0 0 ${CHART.width} ${CHART.height}`} class="ride-preview-elevation-svg">
                {elevation.yTicks.map(tick => (
                  <line x1={plotLeft} x2={plotRight} y1={tick.position} y2={tick.position}
                        stroke="var(--elevation-grid)" stroke-width="0.5" />
                ))}
                <path d={elevation.svgArea} fill="var(--elevation-fill)" />
                <path d={elevation.svgPath} fill="none" stroke="var(--elevation-line)" stroke-width="2" />
                {elevation.yTicks.map(tick => (
                  <text x={plotLeft - 5} y={tick.position + 4} text-anchor="end"
                        font-size="11" fill="var(--elevation-text)">{tick.label}</text>
                ))}
                {elevation.xTicks.map(tick => (
                  <text x={tick.position} y={plotBottom + 16} text-anchor="middle"
                        font-size="11" fill="var(--elevation-text)">{tick.label}</text>
                ))}
                <text x={plotRight} y={plotBottom + 16} text-anchor="middle"
                      font-size="11" fill="var(--elevation-text)">km</text>
              </svg>
            </div>
          );
        })()}

        {photos.length > 0 && (
          <div class="ride-preview-gallery">
            {photos.map((photo) => (
              <img key={photo.key} src={rideImageUrl(photo, { width: 200 })} alt={photo.caption || ''} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback } from 'preact/hooks';
import VideoPlayer from './VideoPlayer';

interface VideoSource {
  src: string;
  type: string;
}

export interface VideoGalleryItem {
  type: 'hosted' | 'youtube';
  key: string;
  title?: string;
  detailUrl?: string;
  thumbUrl: string;
  // Hosted video fields
  sources?: VideoSource[];
  poster?: string;
  fallbackUrl?: string;
  width?: number;   // display size for <video> HTML attributes
  height?: number;
  aspectW?: number;  // original dimensions for CSS aspect-ratio
  aspectH?: number;
  // YouTube fields
  youtubeId?: string;
}

interface Props {
  videos: VideoGalleryItem[];
}

export default function VideoGallery({ videos }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [rotating, setRotating] = useState(videos.length > 1);
  const [userActivated, setUserActivated] = useState(false);

  if (videos.length === 0) return null;

  const stopRotation = useCallback(() => {
    setRotating(false);
    setUserActivated(true);
  }, []);

  // Auto-rotate: wait for current video to end, then switch to next
  useEffect(() => {
    if (!rotating || videos.length <= 1) return;

    const playerCol = document.querySelector('.video-gallery--player');
    if (!playerCol) return;

    const onEnded = () => {
      setActiveIdx(prev => (prev + 1) % videos.length);
    };

    // Listen for 'ended' on whichever <video> is currently in the player
    playerCol.addEventListener('ended', onEnded, true);
    return () => { playerCol.removeEventListener('ended', onEnded, true); };
  }, [rotating, videos.length, activeIdx]);

  // User clicks a thumbnail — stop rotating, switch to that video
  const selectVideo = useCallback((i: number) => {
    stopRotation();
    setActiveIdx(i);
  }, [stopRotation]);

  // User interacts with the player (unmute, seek, etc.) — stop rotating
  const onPlayerInteract = useCallback(() => {
    if (rotating) stopRotation();
  }, [rotating, stopRotation]);

  const active = videos[activeIdx];

  // Original dimensions for aspect ratio
  const aw = active.aspectW || active.width || 640;
  const ah = active.aspectH || active.height || 360;
  const isPortrait = ah > aw;
  const maxWPx = isPortrait ? 360 : 640;
  const maxW = `${maxWPx}px`;
  const playerH = Math.round(maxWPx * ah / aw);
  const thumbsMaxH = `${playerH}px`;

  const hasMultiple = videos.length > 1;

  return (
    <div class="video-gallery" style={`--video-max-w: ${maxW}; --video-aspect: ${aw} / ${ah}; --video-thumbs-max-h: ${thumbsMaxH};`}>
      {active.title && (
        <p class="video-gallery--active-title">
          {active.detailUrl
            ? <a href={active.detailUrl}>{active.title}</a>
            : active.title}
        </p>
      )}
      <div class="video-gallery--row">
        <div class="video-gallery--player-col">
          <div class="video-gallery--player" onClickCapture={onPlayerInteract}>
          {active.type === 'hosted' && active.sources && (
            <VideoPlayer
              key={active.key}
              sources={active.sources}
              poster={active.poster || ''}
              fallbackUrl={active.fallbackUrl || ''}
              width={active.width || 640}
              height={active.height || 360}
              title={active.title}
              autoPlay
              muted={!userActivated}
              initialVolume={userActivated ? 0.5 : 0}
            />
          )}
          {active.type === 'youtube' && active.youtubeId && (
            <div class="video-gallery--youtube" key={active.key}>
              <iframe
                src={`https://www.youtube-nocookie.com/embed/${active.youtubeId}${rotating ? '?autoplay=1&mute=1' : ''}`}
                title={active.title || 'Video'}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                loading="lazy"
              />
            </div>
          )}
          </div>
        </div>
        {hasMultiple && (
          <div class="video-gallery--thumbs">
            {videos.map((v, i) => (
              <button
                key={v.key}
                class={`video-gallery--thumb${i === activeIdx ? ' video-gallery--thumb-active' : ''}`}
                onClick={() => selectVideo(i)}
                aria-label={v.title || `Video ${i + 1}`}
                type="button"
              >
                <div class="video-gallery--thumb-img">
                  <img src={v.thumbUrl} alt="" loading="lazy" />
                  <span class="video-gallery--thumb-play">▶</span>
                </div>
                {v.title && <span class="video-gallery--thumb-title">{v.title}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

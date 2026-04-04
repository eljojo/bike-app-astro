import { useState } from 'preact/hooks';
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
  width?: number;
  height?: number;
  // YouTube fields
  youtubeId?: string;
}

interface Props {
  videos: VideoGalleryItem[];
}

export default function VideoGallery({ videos }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  if (videos.length === 0) return null;

  const active = videos[activeIdx];

  return (
    <div class="video-gallery">
      <div class="video-gallery--player">
        {active.type === 'hosted' && active.sources && (
          <VideoPlayer
            key={active.key}
            sources={active.sources}
            poster={active.poster || ''}
            fallbackUrl={active.fallbackUrl || ''}
            width={active.width || 640}
            height={active.height || 360}
            title={active.title}
          />
        )}
        {active.type === 'youtube' && active.youtubeId && (
          <div class="video-gallery--youtube" key={active.key}>
            <iframe
              src={`https://www.youtube-nocookie.com/embed/${active.youtubeId}`}
              title={active.title || 'Video'}
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              loading="lazy"
            />
          </div>
        )}
        {active.title && (
          <p class="video-gallery--title">
            {active.detailUrl
              ? <a href={active.detailUrl}>{active.title}</a>
              : active.title}
          </p>
        )}
      </div>
      {videos.length > 1 && (
        <div class="video-gallery--thumbs">
          {videos.map((v, i) => (
            <button
              key={v.key}
              class={`video-gallery--thumb${i === activeIdx ? ' video-gallery--thumb-active' : ''}`}
              onClick={() => setActiveIdx(i)}
              aria-label={v.title || `Video ${i + 1}`}
              type="button"
            >
              <img src={v.thumbUrl} alt="" loading="lazy" />
              <span class="video-gallery--thumb-play">▶</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

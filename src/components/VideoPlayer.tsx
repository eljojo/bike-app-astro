import { useEffect, useRef } from 'preact/hooks';
import type HlsType from 'hls.js';

interface VideoSource {
  src: string;
  type: string;
}

interface Props {
  sources: VideoSource[];
  poster: string;
  fallbackUrl: string;
  width: number;
  height: number;
  title?: string;
  autoPlay?: boolean;
  muted?: boolean;
  initialVolume?: number;
}

const DESKTOP_MIN_WIDTH = 768;

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium');
}

export default function VideoPlayer({ sources, poster, fallbackUrl, width, height, title, autoPlay, muted, initialVolume }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    if (initialVolume != null) video.volume = initialVolume;

    // Skip HLS.js on mobile and Safari (native HLS support)
    if (window.innerWidth < DESKTOP_MIN_WIDTH || isSafari()) return;

    const hlsSource = sources.find(s => s.type === 'application/vnd.apple.mpegurl');
    if (!hlsSource) return;

    let hls: HlsType | null = null;

    import('hls.js').then(({ default: Hls }) => {
      if (!Hls.isSupported()) return;

      hls = new Hls({ abrEwmaDefaultEstimate: 10_000_000 });
      hls.loadSource(hlsSource.src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
        hls!.currentLevel = data.levels.length - 1;
      });

      hls.on(Hls.Events.ERROR, (_event, data) => {
        if (data.fatal && fallbackUrl) {
          hls!.destroy();
          video.src = fallbackUrl;
        }
      });
    });

    return () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      if (hls) hls.destroy();
    };
  }, []);

  return (
    <video
      ref={videoRef}
      controls
      preload={autoPlay ? 'auto' : 'metadata'}
      width={width}
      height={height}
      poster={poster}
      disablePictureInPicture
      aria-label={title}
      autoPlay={autoPlay}
      muted={muted}
      playsInline
    >
      {sources.map(s => (
        <source src={s.src} type={s.type} />
      ))}
      <p><a href={fallbackUrl}>{title || 'Download video'}</a></p>
    </video>
  );
}

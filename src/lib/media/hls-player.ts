/**
 * HLS player — progressively enhances <video> elements with hls.js.
 *
 * On desktop (iPad-sized screens and up), hls.js takes over HLS playback
 * on all browsers — including Safari — and forces the highest quality
 * level from the first segment. Ride videos are short, and spending half
 * the video on 480p while ABR ramps up looks bad on a big screen.
 *
 * On mobile, hls.js is not loaded. Safari plays HLS natively with
 * adaptive quality. Chrome/Firefox fall through to the H.264 MP4 source.
 *
 * Import this file from any page that renders <video> with HLS sources.
 * It self-initializes on DOMContentLoaded.
 */

const DESKTOP_MIN_WIDTH = 768;

async function initHlsPlayers() {
  if (window.innerWidth < DESKTOP_MIN_WIDTH) return;

  const videos = document.querySelectorAll<HTMLVideoElement>('video');
  if (!videos.length) return;

  // Find videos that have an HLS source
  const hlsVideos: { video: HTMLVideoElement; src: string }[] = [];
  for (const video of videos) {
    const hlsSource = video.querySelector<HTMLSourceElement>('source[type="application/vnd.apple.mpegurl"]');
    if (hlsSource?.src) {
      hlsVideos.push({ video, src: hlsSource.src });
    }
  }
  if (!hlsVideos.length) return;

  const Hls = (await import('hls.js')).default;
  if (!Hls.isSupported()) return;

  for (const { video, src } of hlsVideos) {
    const hls = new Hls({
      // Assume a fast connection so hls.js picks the highest quality
      // from the first segment. Desktop connections can handle it.
      abrEwmaDefaultEstimate: 10_000_000,
    });
    hls.loadSource(src);
    hls.attachMedia(video);

    // Force the highest level once the manifest is loaded
    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      hls.currentLevel = data.levels.length - 1;
    });

    // Remove the MP4 fallback sources since hls.js is handling playback
    for (const s of video.querySelectorAll('source[type="video/mp4"]')) {
      s.remove();
    }
  }
}

document.addEventListener('DOMContentLoaded', initHlsPlayers);

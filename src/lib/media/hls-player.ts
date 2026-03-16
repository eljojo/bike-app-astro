/**
 * HLS player — progressively enhances <video> elements with hls.js.
 *
 * On browsers without native HLS (Chrome, Firefox), hls.js takes over
 * and starts at the highest quality level so short videos look sharp
 * from the first frame. On Safari (native HLS), we leave playback to
 * the browser — it handles adaptive streaming natively.
 *
 * Import this file from any page that renders <video> with HLS sources.
 * It self-initializes on DOMContentLoaded.
 */

async function initHlsPlayers() {
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

  // Safari handles HLS natively — no need for hls.js
  const Hls = (await import('hls.js')).default;
  if (!Hls.isSupported()) return;

  for (const { video, src } of hlsVideos) {
    const hls = new Hls({
      // Assume a fast connection so hls.js picks the highest quality
      // from the first segment. Ride videos are short — spending half
      // the video on 480p while the ABR ramps up looks bad.
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

/**
 * HLS player — progressively enhances <video> elements with hls.js.
 *
 * Safari handles HLS natively (and decodes HEVC), so we leave it alone.
 * On other browsers, hls.js takes over and forces the highest quality
 * level from the first segment. Ride videos are short, and spending
 * half the video on 480p while ABR ramps up looks bad.
 *
 * Browsers with native HLS support (Safari, recent Chrome) will report
 * Hls.isSupported() === false, so hls.js no-ops there.
 *
 * Import this file from any page that renders <video> with HLS sources.
 * It self-initializes on DOMContentLoaded.
 */

function isSafari(): boolean {
  const ua = navigator.userAgent;
  return ua.includes('Safari') && !ua.includes('Chrome') && !ua.includes('Chromium');
}

async function initHlsPlayers() {
  if (isSafari()) return; // Safari handles HLS natively with HEVC support

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
    // Save MP4 fallback URL before hls.js takes over
    const mp4Source = video.querySelector<HTMLSourceElement>('source[type="video/mp4"]');
    const mp4Url = mp4Source?.src;

    const hls = new Hls({
      abrEwmaDefaultEstimate: 10_000_000,
    });
    hls.loadSource(src);
    hls.attachMedia(video);

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      hls.currentLevel = data.levels.length - 1;
    });

    // If hls.js fails (e.g. HEVC not supported in MSE), fall back to MP4
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (data.fatal && mp4Url) {
        hls.destroy();
        video.src = mp4Url;
      }
    });
  }
}

document.addEventListener('DOMContentLoaded', initHlsPlayers);

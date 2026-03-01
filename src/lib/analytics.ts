import Plausible from 'plausible-tracker';

const { trackPageview, trackEvent } = Plausible({ apiHost: 'https://ottawabybike.ca' });

trackPageview();

declare global {
  interface Window {
    BikeApp: { tE: typeof trackEvent };
  }
}

window.BikeApp = { tE: trackEvent };

function trackVideoPlays() {
  document.querySelectorAll('video').forEach((video) => {
    video.addEventListener('play', (event) => {
      const el = event.target as HTMLVideoElement;
      if (el.autoplay || el.currentTime !== 0) return;
      const page = window.location.pathname;
      trackEvent('Video: Play', { props: { page, video: el.currentSrc } });
    });
  });
}

function trackLinkClicks() {
  document.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', function (this: HTMLAnchorElement) {
      if (!this.href || this.getAttribute('href') === '#') return;

      const linkUrl = new URL(this.href);
      const host = linkUrl.hostname;
      const thisHost = window.location.hostname;
      let destination = host.replace('www.', '');

      if (host === thisHost) {
        const path = linkUrl.pathname;
        switch (true) {
          case path.endsWith('/map'): destination = 'map page'; break;
          case path.endsWith('/about'): destination = 'about'; break;
          case path.endsWith('/calendar'): destination = 'calendar'; break;
          case path.includes('/routes'): destination = 'routes'; break;
          case path.includes('/videos'): destination = 'videos'; break;
          case path.includes('/guides'): destination = 'guides'; break;
          case path.includes('gpx'): destination = 'gpx'; break;
          case path.endsWith('.jpg'): return;
          case path.endsWith('.webp'): return;
          default: destination = 'other';
        }
      } else if (this.href.includes('goo.gl/maps') || this.href.includes('google.com/maps')) {
        destination = 'google maps';
      }

      const page = window.location.pathname;
      const label = (this.textContent || '').substring(0, 80);
      trackEvent('Link: Click', { props: { url: this.href, site: host, destination, label, page } });
    });
  });
}

function trackSocialReferral() {
  const params = new URLSearchParams(location.search);
  const networks: Record<string, string> = { fbclid: 'facebook', rdt_cid: 'reddit' };
  for (const [key, value] of Object.entries(networks)) {
    if (params.get(key)) {
      trackEvent('Social Visit', { props: { network: value } });
      break;
    }
  }
}

function recordVisit() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString();
  const lastVisitDay = localStorage.getItem('lastVisitDay');
  let visitCount = parseInt(localStorage.getItem('visitCount') || '0');
  if (!lastVisitDay || lastVisitDay !== todayStr) {
    visitCount = visitCount ? visitCount + 1 : 1;
    if (visitCount > 1) {
      trackEvent('Repeat Visit', { props: { totalVisits: String(visitCount) } });
    }
  }
  localStorage.setItem('lastVisitDay', todayStr);
  localStorage.setItem('visitCount', String(visitCount));
}

trackSocialReferral();
recordVisit();

document.addEventListener('DOMContentLoaded', () => {
  trackVideoPlays();
  trackLinkClicks();
});

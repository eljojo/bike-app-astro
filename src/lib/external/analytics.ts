import { init, track } from '@plausible-analytics/tracker';

init({ domain: location.hostname, endpoint: '/api/event', autoCapturePageviews: true, bindToWindow: false });

declare global {
  interface Window {
    BikeApp: { tE: (name: string, options?: Parameters<typeof track>[1]) => void };
  }
}

window.BikeApp = { tE: track as Window['BikeApp']['tE'] };

function trackVideoPlays() {
  document.querySelectorAll('video').forEach((video) => {
    video.addEventListener('play', (event) => {
      const el = event.target as HTMLVideoElement;
      if (el.autoplay || el.currentTime !== 0) return;
      const page = window.location.pathname;
      track('Video: Play', { props: { page, video: el.currentSrc } });
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
          case path.endsWith('/map') || path.endsWith('/carte'): destination = 'map page'; break;
          case path.endsWith('/about') || path.endsWith('/a-propos'): destination = 'about'; break;
          case path.endsWith('/calendar') || path.endsWith('/calendrier'): destination = 'calendar'; break;
          case path.includes('/routes') || path.includes('/parcours'): destination = 'routes'; break;
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
      track('Link: Click', { props: { url: this.href, site: host, destination, label, page } });
    });
  });
}

function trackSocialReferral() {
  const params = new URLSearchParams(location.search);
  const networks: Record<string, string> = { fbclid: 'facebook', rdt_cid: 'reddit' };
  for (const [key, value] of Object.entries(networks)) {
    if (params.get(key)) {
      track('Social Visit', { props: { network: value } });
      return;
    }
  }
  // utm_source-based referrals (ChatGPT, newsletters, etc.)
  const utmSource = params.get('utm_source');
  if (utmSource) {
    track('Social Visit', { props: { network: utmSource.replace(/\.com$/, '') } });
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
      track('Repeat Visit', { props: { totalVisits: String(visitCount) } });
    }
  }
  localStorage.setItem('lastVisitDay', todayStr);
  localStorage.setItem('visitCount', String(visitCount));
}

trackSocialReferral();
recordVisit();

// Module scripts are deferred — DOM is ready when this runs.
trackVideoPlays();
trackLinkClicks();

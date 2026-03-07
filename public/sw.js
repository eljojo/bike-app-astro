const CACHE_VERSION = 'v1';
const APP_SHELL_CACHE = `app-shell-${CACHE_VERSION}`;

const APP_SHELL_URLS = [
  '/offline.html',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(APP_SHELL_CACHE).then((cache) => cache.addAll(APP_SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      const visits = await getVisitData();
      const trackedSlugs = new Set(visits.map((v) => v.slug));

      await Promise.all(
        keys
          .filter((key) => {
            if (key.startsWith('app-shell-') && key !== APP_SHELL_CACHE) return true;
            if (key.startsWith('media-') && !trackedSlugs.has(key.replace('media-', ''))) return true;
            return false;
          })
          .map((key) => caches.delete(key))
      );
    })()
  );
  self.clients.claim();
});

const MAX_CACHED_ROUTES = 3;
const VISITS_CACHE = 'route-visits';
const ROUTE_PATH_RE = __ROUTE_PATH_RE__;

const CDN_ORIGIN = '__CDN_ORIGIN__';
const TILES_ORIGIN = '__TILES_ORIGIN__';

const PAGES_CACHE = 'pages';
const SKIP_PATHS = ['/admin', '/api/', '/login', '/setup', '/gate', '/sw.js'];

async function getVisitData() {
  const cache = await caches.open(VISITS_CACHE);
  const response = await cache.match('visits');
  if (!response) return [];
  return response.json();
}

async function saveVisitData(data) {
  const cache = await caches.open(VISITS_CACHE);
  await cache.put('visits', new Response(JSON.stringify(data)));
}

function routeSlugFromPath(pathname) {
  const match = pathname.match(ROUTE_PATH_RE);
  return match ? match[2] : null;
}

async function trackRouteVisit(slug) {
  const visits = await getVisitData();
  const existing = visits.find((v) => v.slug === slug);

  if (existing) {
    existing.visitCount++;
    existing.lastVisit = Date.now();
  } else {
    // Evict if at capacity
    if (visits.length >= MAX_CACHED_ROUTES) {
      // Sort by visitCount asc, then lastVisit asc — evict first
      visits.sort((a, b) => a.visitCount - b.visitCount || a.lastVisit - b.lastVisit);
      const evicted = visits.shift();
      if (evicted) {
        await caches.delete(`media-${evicted.slug}`);
      }
    }
    visits.push({ slug, visitCount: 1, lastVisit: Date.now() });
  }

  await saveVisitData(visits);
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // Skip admin/API/auth paths
  if (SKIP_PATHS.some((p) => url.pathname.startsWith(p))) return;

  // App shell assets: /_astro/*, /fonts/*
  if (url.pathname.startsWith('/_astro/') || url.pathname.startsWith('/fonts/')) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }

  // Static assets at root (favicon, bicycle.png, manifest)
  if (/^\/(favicon\.ico|bicycle\.png|manifest\.webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }

  const isHtml = request.headers.get('accept')?.includes('text/html');

  // CDN images (route photos)
  if (url.origin === CDN_ORIGIN && !isHtml) {
    event.respondWith(handleMediaRequest(request, url));
    return;
  }

  // Map tiles
  if (url.origin === TILES_ORIGIN && !isHtml) {
    event.respondWith(handleMediaRequest(request, url));
    return;
  }

  // Same-origin HTML pages (navigation requests)
  if (url.origin === self.location.origin && isHtml) {
    const slug = routeSlugFromPath(url.pathname);
    if (slug) {
      event.waitUntil(trackRouteVisit(slug));
    }
    event.respondWith(networkFirst(request));
    return;
  }

  // Same-origin static assets (map thumbnails, SVGs, etc.)
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirst(request, APP_SHELL_CACHE));
    return;
  }
});

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response('Network error', { status: 503 });
  }
}

async function networkFirst(request) {
  try {
    // Fetch by URL so redirects are followed normally — navigation requests
    // have redirect:"manual" which produces opaque redirect responses that
    // Safari rejects with "has redirections".
    // Then wrap in a new Response to strip the `redirected` flag, which
    // Safari also rejects for navigation respondWith().
    const networkResponse = await fetch(request.url);
    if (networkResponse.ok) {
      const response = new Response(networkResponse.body, {
        status: networkResponse.status,
        statusText: networkResponse.statusText,
        headers: networkResponse.headers,
      });
      const cache = await caches.open(PAGES_CACHE);
      cache.put(request, response.clone());
      return response;
    }
    return networkResponse;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || new Response('<h1>Offline</h1><p><a href="/">Go to homepage</a></p>',
      { status: 503, headers: { 'Content-Type': 'text/html' } });
  }
}

async function handleMediaRequest(request, url) {
  // Determine which route this media belongs to
  const referer = request.headers.get('referer');
  let slug = null;
  if (referer) {
    try {
      slug = routeSlugFromPath(new URL(referer).pathname);
    } catch {}
  }

  // If we can associate with a tracked route, use per-route cache
  if (slug) {
    const visits = await getVisitData();
    const tracked = visits.find((v) => v.slug === slug);
    if (tracked) {
      return cacheFirst(request, `media-${slug}`);
    }
  }

  // Not associated with a tracked route — network only, no caching
  try {
    return await fetch(request);
  } catch {
    return new Response('', { status: 503 });
  }
}

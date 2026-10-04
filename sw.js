// Service worker: caches the app shell so it works fully offline after one visit.
// app.js registers this as sw.js?v=<VERSION>, so bumping js/version.js installs a
// fresh worker with a clean cache.
//
// Other apps may live on the same origin, so this worker is a good neighbour:
// - its cache names carry the app name *and* its deployment path;
// - on activation it deletes only its own older caches;
// - it answers only for its own files, and only ever reads its own cache
//   (a bare caches.match() would search every app's caches on the origin).
const SCOPE = new URL('./', self.location).pathname;
const PREFIX = `space-drift:${SCOPE}:`;
const CACHE_NAME = `${PREFIX}${new URL(self.location).searchParams.get('v') ?? 'dev'}`;
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/style.css',
  './js/app.js',
  './js/audio.js',
  './js/rng.js',
  './js/scene.js',
  './js/settings.js',
  './js/textures.js',
  './js/version.js',
  './icons/icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
];
const OWN = new Set(ASSETS.map((a) => new URL(a, self.location).href));

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS.map((a) => new Request(a, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith(PREFIX) && k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  url.search = '';
  url.hash = '';
  if (!OWN.has(url.href)) return;
  const navigate = req.mode === 'navigate';

  // Network first, so an update shows up on the next load and HTML, CSS and JS never
  // mix versions; our own cache is only the offline fallback.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    try {
      // Revalidate rather than trust the HTTP cache: a CDN in front may stamp
      // long max-ages on scripts, which would otherwise delay new releases.
      const response = await fetch(req, { cache: 'no-cache' });
      if (response.ok && OWN.has(url.href)) cache.put(url.href, response.clone());
      return response;
    } catch {
      return (await cache.match(url.href)) ?? (navigate ? await cache.match(new URL('./index.html', self.location).href) : undefined) ?? Response.error();
    }
  })());
});

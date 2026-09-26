// StatLens Service Worker — stale-while-revalidate with update notification.
// DEPLOY_VERSION is replaced by deploy.sh on each deploy.
//
// Everything below is derived from where this file is *served*, never hardcoded,
// because the same file runs two sites on one origin: learnlens.org/statlens/
// and learnlens.org/statlens-dev/. Two bugs came out of assuming otherwise.
//
//   1. The app shell was a list of literal production paths, and deploy.sh
//      stamps the version into the dev copy without rewriting them. The dev
//      worker therefore installed by downloading 36 *production* files. Harmless
//      to what a reader saw — dev pages request /statlens-dev/ URLs, which never
//      matched those keys — but it primed a cache for a site nobody on dev was
//      looking at.
//
//   2. Worse: CacheStorage is per *origin*, and `activate` deleted every cache
//      whose name was not its own. The two sites stamp different hashes, so each
//      deploy evicted the other site's cache. Anyone using both — which is
//      exactly what a dev site is for — had offline support and warm loads
//      permanently sabotaged.
//
// BASE is the scope this worker controls (BASE or '/statlens-dev/'), so
// the shell caches the right files and the cache name carries the site with it.
const BASE = self.location.pathname.replace(/sw\.js$/, '');
const SITE = BASE.replace(/^\/|\/$/g, '').replace(/\//g, '-') || 'root';
const CACHE_NAME = `${SITE}@af71985f`;

// App shell — the core files needed for the app to work, relative to BASE
const APP_SHELL = [
  BASE,
  BASE + 'index.html',
  BASE + 'css/style.css',
  BASE + 'favicon.svg',
  BASE + 'icon-192.png',
  BASE + 'icon-512.png',
  BASE + 'manifest.json',
  // Core JS modules
  BASE + 'js/stats.js',
  BASE + 'js/prng.js',
  BASE + 'js/csv-parser.js',
  BASE + 'js/url-params.js',
  BASE + 'js/types.js',
  BASE + 'js/chart-utils.js',
  BASE + 'js/histogram.js',
  BASE + 'js/dotplot.js',
  BASE + 'js/boxplot.js',
  BASE + 'js/scatterplot.js',
  BASE + 'js/barchart.js',
  BASE + 'js/curve.js',
  BASE + 'js/page-utils.js',
  BASE + 'js/sim-engine.js',
  BASE + 'js/sim-app.js',
  BASE + 'js/dist-app.js',
  BASE + 'js/distributions.js',
  BASE + 'js/inference.js',
  BASE + 'js/conclusions.js',
  BASE + 'js/theory-overlay.js',
  BASE + 'js/chart-interactions.js',
  BASE + 'js/spike.js',
  BASE + 'js/settings.js',
  BASE + 'js/one-sample-sim.js',
  BASE + 'js/chart-defaults.js',
  BASE + 'js/kde.js',
  BASE + 'js/export.js',
  BASE + 'js/share.js',
  // Dataset index
  BASE + 'data/datasets.json',
];

// Install: cache app shell (best-effort — don't block install on individual fetch failures)
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      Promise.allSettled(
        APP_SHELL.map((url) =>
          cache.add(url).catch(() => {
            // Individual file failed (network error, 404) — log but continue
            console.warn('[SW] Failed to cache:', url);
          })
        )
      )
    )
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// Activate: clean old caches, notify clients
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      // Only this site's own old versions, plus the pre-fix caches. `statlens`
      // and `statlens-dev` share an origin, and evicting the other one's cache
      // is not ours to do — which is exactly what this worker used to do.
      //
      // The legacy name was `statlens-<8 hex>` for *both* sites, so those are
      // indistinguishable and cleaning them is safe: whichever site owned one,
      // it is stale, and that site will rebuild its own on next visit.
      Promise.all(keys
        .filter((k) => (k.startsWith(`${SITE}@`) && k !== CACHE_NAME)
          || /^statlens-[0-9a-f]{8}$/.test(k))
        .map((k) => caches.delete(k)))
    ).then(() => {
      // Tell all open pages that a new version is active
      self.clients.matchAll({ type: 'window' }).then((clients) => {
        for (const client of clients) {
          client.postMessage({ type: 'SW_UPDATED' });
        }
      });
    })
  );
  self.clients.claim();
});

// Fetch: stale-while-revalidate for local, network-first for CDN
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Skip non-GET requests
  if (event.request.method !== 'GET') return;

  // CDN requests — network first, fall back to cache
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Activity definitions: network-first. Instructors iterate on these and
  // students must get the latest on every load — stale-while-revalidate would
  // serve a one-load-old activity (e.g. missing a newly added demo step).
  // Falls back to cache when offline.
  if (url.pathname.includes('/activities/') && url.pathname.endsWith('.json')) {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => caches.match(event.request))
    );
    return;
  }

  // Local resources: stale-while-revalidate
  event.respondWith(
    caches.open(CACHE_NAME).then((cache) =>
      cache.match(event.request).then((cached) => {
        const fetchPromise = fetch(event.request).then((response) => {
          if (response.ok) cache.put(event.request, response.clone());
          return response;
        }).catch(() => cached);

        // Ensure we always return a valid Response (never undefined)
        return cached || fetchPromise.then(r => r || fetch(event.request));
      })
    )
  );
});

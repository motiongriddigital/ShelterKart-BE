/**
 * Minimal offline shell cache — not a full offline data strategy (this
 * product's whole value is live, current public records, so there is no
 * good "offline report" to serve). This only makes the app shell itself
 * load instantly on repeat visits and keeps the last-viewed page
 * reachable if the connection drops mid-session.
 *
 * Note: service workers only register over HTTPS (or localhost) — this
 * silently no-ops on a file:// double-clicked HTML file, which is
 * expected and harmless. See the registration try/catch in the HTML.
 *
 * CACHE_NAME below is a placeholder a deploy step must substitute --
 * see the comment at the bottom. Left unsubstituted, every deploy
 * shares one cache name and the browser never notices anything changed.
 */
const CACHE_NAME = 'shelterkart-shell-__BUILD_HASH__';
const SHELL_FILES = ['./shelterkart-frontend.html', './manifest.json'];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      // addAll is atomic: one missing file fails the whole precache
      // silently. Each file is cached independently instead, so a
      // rename or a missing asset degrades the shell rather than
      // leaving the whole cache empty with no signal that it happened.
      Promise.all(SHELL_FILES.map(url =>
        cache.add(url).catch(err => console.warn('[sw] could not precache', url, err))
      ))
    )
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k.startsWith('shelterkart-shell-') && k !== CACHE_NAME).map(k => caches.delete(k))
    ))
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;

  // Never cache API responses — a stale trust score is worse than no
  // score at all.
  if (event.request.url.includes('/api/')) return;

  /* Network-first for the shell, cache only as an offline fallback.
   * See the earlier note on why cache-first was wrong for this product.
   */
  event.respondWith(
    fetch(event.request)
      .then(res => {
        // A 404 or 500 must never be cached: the next offline visit
        // would be served that error as if it were the real page,
        // which looks like the site is broken rather than offline.
        if (res.ok) {
          const copy = res.clone();
          // Attached to waitUntil so the worker cannot be terminated
          // mid-write; an unattached promise here means some writes
          // silently never finish under load.
          event.waitUntil(
            caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy)).catch(() => {})
          );
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        // A page-load request with nothing cached and no network would
        // otherwise resolve to undefined, which respondWith cannot
        // handle -- the user gets the browser's unbranded error page.
        // Serving the shell for a navigation, and a plain response
        // otherwise, means that never happens.
        if (event.request.mode === 'navigate') {
          const shell = await caches.match('./shelterkart-frontend.html');
          if (shell) return shell;
        }
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      })
  );
});

/* __BUILD_HASH__ must be replaced with a real build identifier (a
 * commit SHA, a deploy timestamp) by whatever serves this file. Left
 * as-is, every deploy shares one cache name, activate() has nothing to
 * evict, and a browser that already has the old shell cached keeps
 * serving it indefinitely -- exactly the failure mode this file's own
 * network-first design exists to prevent. */

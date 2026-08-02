// Copyright (c) 2026 NoHungryPets
// Service worker for PWA installability. Deliberately narrow scope: only
// caches the site's own static shell (HTML/CSS/JS/icons). Everything
// cross-origin - Firebase Auth, Firestore, Google Fonts, Leaflet CDN,
// reCAPTCHA, postcodes.io - is left completely untouched and always goes
// straight to the network, so listings/auth state are never served stale
// from cache.
//
// Network-first, not stale-while-revalidate: this site ships multiple
// deploys per session during active development, and "always at least one
// load behind" was actively confusing testing. Always try the network
// first; only fall back to cache when actually offline.
//
// Bump CACHE_VERSION on any change to this file or to SHELL_URLS so old
// caches get cleared on the next visit.
const CACHE_VERSION = 'nhp-shell-v2';

const SHELL_URLS = [
  '/', '/index.html', '/about.html', '/admin.html', '/contact.html',
  '/guidelines.html', '/listings.html', '/login.html', '/map.html',
  '/post.html', '/privacy.html', '/profile.html', '/terms.html',
  '/css/style.css', '/js/auth.js', '/js/main.js', '/js/messaging.js',
  '/manifest.json',
  '/icons/icon-192.png', '/icons/icon-512.png',
  '/icons/icon-maskable-512.png', '/icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(SHELL_URLS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
    return; // let the browser handle it normally - no interception
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request)) // offline fallback only
  );
});

const CACHE_NAME = "studysched-v3";

self.addEventListener("install", function(event) {
  self.skipWaiting();
});

self.addEventListener("activate", function(event) {
  event.waitUntil(
    caches.keys().then(function(keys) {
      return Promise.all(
        keys.map(function(key) {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// Network first for JS files (always get latest code)
self.addEventListener("fetch", function(event) {
  const url = event.request.url;

  if (url.includes("app.js") || url.includes("index.html")) {
    event.respondWith(
      fetch(event.request)
        .then(function(response) {
          return response;
        })
        .catch(function() {
          return caches.match(event.request);
        })
    );
  } else {
    event.respondWith(
      caches.match(event.request).then(function(response) {
        return response || fetch(event.request);
      })
    );
  }
});
// Stamped with the build id (version + short commit) at build time by
// scripts/stamp-sw.mjs (npm postbuild) so every deploy gets a fresh cache and the
// activate handler purges the old one. The literal placeholder only survives in
// local dev, where the worker doesn't cache anyway (http, not https).
const cacheName = "1.6.1-66b048d";

const deleteCache = async (key) => {
  await caches.delete(key);
};

const deleteOldCaches = async () => {
  const cacheKeepList = [cacheName];
  const keyList = await caches.keys();
  const cachesToDelete = keyList.filter((key) => !cacheKeepList.includes(key));
  await Promise.all(cachesToDelete.map(deleteCache));
};

self.addEventListener("install", () => {
  // Activate this worker as soon as it finishes installing instead of waiting
  // for all tabs running the previous worker to close.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      await deleteOldCaches();
      // Take control of already-open pages so the new version applies on reload.
      await self.clients.claim();
    })(),
  );
});

const putInCache = async (request, response) => {
  const cache = await caches.open(cacheName);
  await cache.put(request, response);
};

const cacheFirst = async (request, event) => {
  const responseFromCache = await caches.match(request);
  if (responseFromCache) {
    return responseFromCache;
  }
  const responseFromNetwork = await fetch(request);
  event.waitUntil(putInCache(request, responseFromNetwork.clone()));
  return responseFromNetwork;
};

self.addEventListener("fetch", (event) => {
  if (event.request.url.startsWith("https:")) {
    event.respondWith(cacheFirst(event.request, event));
  }
});

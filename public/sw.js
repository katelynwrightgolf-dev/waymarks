// Waymarks service worker — lets the app open and work with no cell service.
//
//  - The app page ("/") is fetched from the network when possible (with a
//    short timeout for weak signal) and a copy is kept to open offline.
//  - Next.js build files and icons are kept once downloaded.
//  - Map tiles you've already looked at are kept, so a map you've seen still
//    draws offline (tiles you haven't seen just stay blank).
//  - /api/* and the places database are not handled here: live data needs
//    the network, and lib/places.ts stores the places database itself.
//
// Signing out deletes the saved page (lib/offline-visits.ts).

const VERSION = "v1"
const PAGES = `waymarks-pages-${VERSION}`
const STATIC = `waymarks-static-${VERSION}`
const TILES = "waymarks-tiles"
const MAX_STATIC = 400
const MAX_TILES = 3000
const PAGE_TIMEOUT_MS = 6000

const OFFLINE_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Waymarks</title>
<style>body{margin:0;min-height:100dvh;display:grid;place-items:center;background:#f9f4ea;color:#3b2a20;
font:16px/1.5 system-ui,sans-serif;text-align:center;padding:24px}h1{font-family:Georgia,serif;margin:0 0 8px}
@media (prefers-color-scheme:dark){body{background:#231813;color:#f3ece2}}</style></head>
<body><div><h1>Waymarks</h1><p>No signal right now. Open Waymarks once while you have service,<br>
and it will work offline after that.</p></div></body></html>`

self.addEventListener("install", () => self.skipWaiting())

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) {
        const stalePages = key.startsWith("waymarks-pages-") && key !== PAGES
        const staleStatic = key.startsWith("waymarks-static-") && key !== STATIC
        if (stalePages || staleStatic) await caches.delete(key)
      }
      await self.clients.claim()
    })(),
  )
})

self.addEventListener("fetch", (event) => {
  const req = event.request
  if (req.method !== "GET") return
  const url = new URL(req.url)

  if (url.hostname === "tile.openstreetmap.org") {
    event.respondWith(cacheFirst(req, TILES, MAX_TILES))
    return
  }
  if (url.origin !== self.location.origin) return
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/places/")) return

  if (req.mode === "navigate") {
    event.respondWith(appPage(req))
    return
  }
  if (url.pathname.startsWith("/_next/static/") || /\.(png|jpg|svg|ico|webmanifest|woff2?)$/.test(url.pathname) || url.pathname === "/manifest.json") {
    event.respondWith(cacheFirst(req, STATIC, MAX_STATIC))
  }
})

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), ms)
    promise.then(
      (value) => {
        clearTimeout(timer)
        resolve(value)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

async function appPage(req) {
  const url = new URL(req.url)
  const cache = await caches.open(PAGES)
  try {
    const res = await withTimeout(fetch(req), PAGE_TIMEOUT_MS)
    // Keep only a real signed-in render of the main page (not a redirect to
    // sign-in, not an error).
    if (url.pathname === "/" && res.ok && !res.redirected) await cache.put("/", res.clone())
    return res
  } catch {
    const saved = await cache.match("/", { ignoreVary: true, ignoreSearch: true })
    return saved ?? new Response(OFFLINE_HTML, { headers: { "Content-Type": "text/html; charset=utf-8" } })
  }
}

async function cacheFirst(req, cacheName, maxEntries) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  const res = await fetch(req)
  if (res.ok) {
    await cache.put(req, res.clone())
    trim(cache, maxEntries)
  }
  return res
}

// Oldest entries go first once a cache is over its limit.
async function trim(cache, maxEntries) {
  const keys = await cache.keys()
  for (let i = 0; i < keys.length - maxEntries; i++) await cache.delete(keys[i])
}

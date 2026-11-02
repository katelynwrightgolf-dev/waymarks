"use client"

// The offline places database: every National Register of Historic Places
// listing plus every official Texas historical marker, names and locations
// only (built by scripts/build-places.mjs). It's downloaded once, kept in the
// browser's Cache Storage, and searched entirely on the phone, so nearby
// places and name search keep working with no cell service.

import type { Landmark } from "@/lib/landmarks"
import { PLACES_URL } from "@/lib/places-manifest"

const CACHE_NAME = "waymarks-places"

type PlaceSet = {
  source: "nrhp" | "thc"
  count: number
  names: string[]
  ids: string[]
  lat: number[] // delta-encoded, degrees × 1e5
  lng: number[]
}

type PlacesFile = { v: number; built: string; sets: PlaceSet[] }

type Index = {
  built: string
  // One entry per place, sorted by latitude so a nearby lookup is a binary
  // search plus a short scan.
  lat: Float64Array
  lng: Float64Array
  source: Uint8Array // 0 = nrhp, 1 = thc
  names: string[]
  ids: string[]
  folded: string[] // lowercased, accent-free names for search
}

const SOURCES = ["nrhp", "thc"] as const
const CATEGORY = ["National Register historic place", "Texas historical marker"]

let indexPromise: Promise<Index> | null = null

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

/** Detail page for a place from the offline database, derived from its id. */
export function placeInfoUrl(id: string): string | null {
  const m = id.match(/^(nrhp|thc)\/(\d+)$/)
  if (!m) return null
  return m[1] === "nrhp"
    ? `https://npgallery.nps.gov/AssetDetail/NRIS/${m[2]}`
    : `https://atlas.thc.texas.gov/Details/${m[2]}`
}

async function fetchPlacesFile(): Promise<PlacesFile> {
  // Prefer the stored copy (works offline); otherwise download and store it.
  const cache = typeof caches !== "undefined" ? await caches.open(CACHE_NAME) : null
  let res = cache ? await cache.match(PLACES_URL) : undefined
  if (!res) {
    const fresh = await fetch(PLACES_URL)
    if (!fresh.ok) throw new Error(`Couldn't download places (HTTP ${fresh.status})`)
    if (cache) {
      await cache.put(PLACES_URL, fresh.clone())
      // Drop older versions of the file.
      for (const req of await cache.keys()) {
        if (!req.url.endsWith(PLACES_URL)) await cache.delete(req)
      }
      // Ask the browser not to evict it under storage pressure.
      void navigator.storage?.persist?.()
    }
    res = fresh
  }
  return (await res.json()) as PlacesFile
}

function buildIndex(file: PlacesFile): Index {
  const total = file.sets.reduce((n, s) => n + s.names.length, 0)
  const rows: { lat: number; lng: number; src: number; name: string; id: string }[] = new Array(total)
  let k = 0
  for (const set of file.sets) {
    const src = SOURCES.indexOf(set.source)
    let la = 0
    let ln = 0
    for (let i = 0; i < set.names.length; i++) {
      la += set.lat[i]
      ln += set.lng[i]
      rows[k++] = { lat: la / 1e5, lng: ln / 1e5, src, name: set.names[i], id: set.ids[i] }
    }
  }
  rows.sort((a, b) => a.lat - b.lat)
  const index: Index = {
    built: file.built,
    lat: new Float64Array(total),
    lng: new Float64Array(total),
    source: new Uint8Array(total),
    names: new Array(total),
    ids: new Array(total),
    folded: new Array(total),
  }
  rows.forEach((r, i) => {
    index.lat[i] = r.lat
    index.lng[i] = r.lng
    index.source[i] = r.src
    index.names[i] = r.name
    index.ids[i] = r.id
    index.folded[i] = fold(r.name)
  })
  return index
}

/** Load (once) and index the offline places. Safe to call repeatedly. */
export function loadPlaces(): Promise<Index> {
  if (!indexPromise) {
    indexPromise = fetchPlacesFile()
      .then(buildIndex)
      .catch((err) => {
        indexPromise = null // let a later call retry
        throw err
      })
  }
  return indexPromise
}

/** Whether the places file is already on this device (no network needed). */
export async function placesAreStored(): Promise<boolean> {
  if (typeof caches === "undefined") return false
  return Boolean(await (await caches.open(CACHE_NAME)).match(PLACES_URL))
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180
  const a =
    Math.sin(toRad(lat2 - lat1) / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lng2 - lng1) / 2) ** 2
  return 2 * 6371000 * Math.asin(Math.sqrt(a))
}

function toLandmark(index: Index, i: number, from?: { lat: number; lng: number }): Landmark {
  const src = index.source[i]
  return {
    id: `${SOURCES[src]}/${index.ids[i]}`,
    name: index.names[i],
    category: CATEGORY[src],
    kind: "landmark",
    lat: index.lat[i],
    lng: index.lng[i],
    description: null,
    wikipedia: null,
    imageUrl: null,
    ...(from ? { distanceMeters: haversine(from.lat, from.lng, index.lat[i], index.lng[i]) } : {}),
  }
}

function lowerBound(arr: Float64Array, value: number) {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (arr[mid] < value) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Every stored place within `radiusMeters`, nearest first. */
export async function nearbyPlaces(lat: number, lng: number, radiusMeters: number): Promise<Landmark[]> {
  const index = await loadPlaces()
  const dLat = radiusMeters / 111_320
  const out: Landmark[] = []
  for (let i = lowerBound(index.lat, lat - dLat); i < index.lat.length && index.lat[i] <= lat + dLat; i++) {
    const d = haversine(lat, lng, index.lat[i], index.lng[i])
    if (d <= radiusMeters) out.push({ ...toLandmark(index, i), distanceMeters: d })
  }
  return out.sort((a, b) => (a.distanceMeters ?? 0) - (b.distanceMeters ?? 0))
}

/**
 * Name search across every stored place. Every word in the query must appear
 * in the name. Results near `near` come first; otherwise names that start with
 * the query rank first.
 */
export async function searchPlaces(
  query: string,
  near?: { lat: number; lng: number } | null,
  limit = 25,
): Promise<Landmark[]> {
  const words = fold(query).split(" ").filter(Boolean)
  if (!words.length) return []
  const index = await loadPlaces()
  const phrase = words.join(" ")
  const hits: { i: number; score: number }[] = []
  for (let i = 0; i < index.folded.length; i++) {
    const name = index.folded[i]
    if (!words.every((w) => name.includes(w))) continue
    const startsWith = name.startsWith(phrase) ? 0 : name.includes(phrase) ? 1 : 2
    const distance = near ? haversine(near.lat, near.lng, index.lat[i], index.lng[i]) : 0
    // Distance dominates when we know where you are; match quality breaks ties.
    hits.push({ i, score: near ? distance + startsWith * 1000 : startsWith * 1e6 + name.length })
  }
  hits.sort((a, b) => a.score - b.score)
  return hits.slice(0, limit).map(({ i }) => toLandmark(index, i, near ?? undefined))
}
